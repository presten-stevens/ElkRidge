# Adding a New Phone Number

Use this guide when you want to connect an additional iMessage phone number to your CRM. Each phone number you add gets its own API instance -- meaning your CRM can send and receive iMessages through multiple numbers independently. For example, you might have Tyler's personal number on one instance and an office line on another, both feeding into the same CRM.

Each phone number requires its own BlueBubbles instance, environment file, PM2 process, and nginx server block. This checklist walks through the full setup.

---

## What Changes Per Instance

Every phone number runs as a separate instance. Here is what differs between instances:

| Setting | Instance 1 | Instance 2 |
|---------|-----------|-----------|
| PM2 name | bb-tyler-iphone | bb-tyler-android |
| Env file | .env.tyler_iphone | .env.tyler_android |
| PORT | 3000 | 3001 |
| Domain | api1.example.com | api2.example.com |
| BB URL | http://localhost:1234 | http://localhost:1235 |

---

## Checklist

### BlueBubbles Setup

- [ ] 1. Set up a new Mac with BlueBubbles installed (or configure an additional BlueBubbles instance on the same Mac using a different port)
- [ ] 2. Sign into iMessage with the new Apple ID on the Mac
- [ ] 3. Verify BlueBubbles can send and receive messages:
  ```bash
  curl http://localhost:BB_PORT/api/v1/server/info?password=YOUR_BB_PASSWORD
  ```
  You should see a JSON response with server info. If not, check that BlueBubbles has Full Disk Access and iMessage is signed in.

### Environment Configuration

- [ ] 4. Create a new environment file from the template:
  ```bash
  cp .env.example .env.NEW_NAME
  ```
  Example: `cp .env.example .env.tyler_android`

- [ ] 5. Edit the new environment file with instance-specific values:
  ```bash
  nano .env.tyler_android
  ```
  Set these values:
  - `PORT=3001` (unique port, different from other instances)
  - `BLUEBUBBLES_URL=http://localhost:1235` (pointing to the new BB instance)
  - `BLUEBUBBLES_PASSWORD=` (password for the new BB instance)
  - `API_KEY=` (generate with `openssl rand -hex 32`)
  - `CRM_WEBHOOK_URL=` (Tyler's CRM endpoint for this number)

### PM2 Configuration

- [ ] 6. Add a new entry to `ecosystem.config.js`:
  ```javascript
  {
    name: 'bb-tyler-android',
    script: 'dist/server.js',
    env_file: '.env.tyler_android',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000,
    watch: false,
    max_memory_restart: '256M',
  },
  ```
  Add this object to the `apps` array in `ecosystem.config.js`, after the existing entries.

- [ ] 7. Build the application (if code has changed):
  ```bash
  npm run build
  ```

- [ ] 8. Start only the new instance:
  ```bash
  pm2 start ecosystem.config.js --only bb-tyler-android
  ```

- [ ] 9. Save the PM2 process list so it survives reboots:
  ```bash
  pm2 save
  ```

### Nginx Configuration

- [ ] 10. Add a new nginx server block. Duplicate the HTTPS server block in `deploy/nginx/bluebubbles-api.conf` and save as a new file:
  ```bash
  cp /opt/homebrew/etc/nginx/servers/bluebubbles-api.conf \
     /opt/homebrew/etc/nginx/servers/bluebubbles-api-android.conf
  ```
  Edit the new file:
  - Change `server_name` to the new domain/subdomain (e.g., `api2.example.com`)
  - Change `proxy_pass` port to match the new instance PORT (e.g., `3001`)

- [ ] 11. Test and restart nginx:
  ```bash
  nginx -t && brew services restart nginx
  ```

- [ ] 12. Set up SSL for the new domain:
  ```bash
  sudo certbot --nginx -d NEW_DOMAIN
  ```

### Verification

- [ ] 13. Verify the new instance is healthy:
  ```bash
  curl -H "Authorization: Bearer YOUR_API_KEY" https://NEW_DOMAIN/health
  ```
  Expected: JSON response with `status: "healthy"`.

---

## Troubleshooting

**PM2 process keeps restarting:**
Check logs with `pm2 logs bb-tyler-android --lines 50`. Common causes: wrong BlueBubbles URL/password, port already in use.

**nginx returns 502 Bad Gateway:**
The Express server is not running or is on a different port. Check `pm2 status` and verify the PORT in the env file matches the nginx `proxy_pass` port.

**Health check shows BlueBubbles offline:**
Verify BlueBubbles Server is running on the Mac and iMessage is signed in. Test the BB API directly: `curl http://localhost:BB_PORT/api/v1/server/info?password=...`

---

*Last updated: 2026-03-30*
