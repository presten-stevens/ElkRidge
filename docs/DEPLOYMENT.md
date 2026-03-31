# AWS EC2 Mac Deployment Guide

Step-by-step guide to deploy the BlueBubbles iMessage API on an AWS EC2 Mac instance. Follow these steps in order.

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Launch EC2 Mac Instance](#2-launch-ec2-mac-instance)
3. [macOS Configuration](#3-macos-configuration)
4. [Install Node.js](#4-install-nodejs)
5. [Install BlueBubbles](#5-install-bluebubbles)
6. [Deploy Application](#6-deploy-application)
7. [PM2 Setup](#7-pm2-setup)
8. [Nginx + SSL](#8-nginx--ssl)
9. [Verify Production](#9-verify-production)
10. [Ongoing Maintenance](#10-ongoing-maintenance)

---

## 1. Prerequisites

Before starting, ensure you have:

- **AWS account** with billing enabled (EC2 Mac instances cost ~$750-900/month)
- **Apple Developer account** (for an Apple ID to sign into iMessage)
- **Domain name** pointed at your server (e.g., `api.yourdomain.com`)
- **SSH key pair** created in the AWS region you plan to use

## 2. Launch EC2 Mac Instance

EC2 Mac instances run on Apple hardware dedicated to your AWS account.

### Allocate a Dedicated Host

EC2 Mac requires a Dedicated Host (24-hour minimum allocation):

1. Open the **AWS Console > EC2 > Dedicated Hosts**
2. Click **Allocate Dedicated Host**
3. Select instance family: **mac1** (Intel) or **mac2** (Apple Silicon)
4. Select your preferred Availability Zone
5. Click **Allocate**

> **Note:** Dedicated Hosts have a 24-hour minimum allocation. You cannot release the host within 24 hours of allocation.

### Launch the Instance

1. Go to **EC2 > Instances > Launch Instance**
2. **Name:** `bluebubbles-api`
3. **AMI:** Search for "macOS" and select the latest macOS Ventura or Sonoma AMI
4. **Instance type:** `mac1.metal` (Intel) or `mac2.metal` (Apple Silicon)
5. **Key pair:** Select your SSH key pair
6. **Security group:** Create a new security group with these inbound rules:

| Port | Protocol | Source      | Purpose         |
|------|----------|-------------|-----------------|
| 22   | TCP      | Your IP     | SSH access      |
| 80   | TCP      | 0.0.0.0/0   | HTTP (redirect) |
| 443  | TCP      | 0.0.0.0/0   | HTTPS           |

7. **Advanced > Tenancy:** Select "Dedicated Host" and pick the host you allocated
8. Click **Launch Instance**

### Assign Elastic IP

1. Go to **EC2 > Elastic IPs > Allocate Elastic IP address**
2. Click **Allocate**
3. Select the new Elastic IP > **Actions > Associate Elastic IP address**
4. Select your EC2 Mac instance
5. Click **Associate**

### Connect via SSH

```bash
ssh -i ~/.ssh/your-key.pem ec2-user@YOUR_ELASTIC_IP
```

## 3. macOS Configuration

After connecting via SSH, configure macOS for headless server operation.

### Disable Sleep

```bash
sudo pmset -a sleep 0 displaysleep 0
```

### Enable Auto-Login

```bash
sudo defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser ec2-user
```

### Set Timezone

```bash
sudo systemsetup -settimezone America/Denver
```

### Install Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

After installation, add Homebrew to your PATH:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Verify:

```bash
brew --version
```

## 4. Install Node.js

```bash
brew install node@20
```

Verify:

```bash
node --version
npm --version
```

Expected output: Node v20.x.x

## 5. Install BlueBubbles

### Download and Install

1. Download the latest BlueBubbles Server release from [https://github.com/BlueBubblesApp/bluebubbles-app/releases](https://github.com/BlueBubblesApp/bluebubbles-app/releases)
2. Open the `.dmg` and drag BlueBubbles to Applications

### Grant Full Disk Access

This is required for BlueBubbles to read the iMessage database:

1. Open **System Settings > Privacy & Security > Full Disk Access**
2. Click the lock icon and authenticate
3. Add **BlueBubbles** (from Applications)
4. Add **Terminal** (from Applications > Utilities)

### Sign Into iMessage

1. Open **System Settings > Apple ID** (or Internet Accounts on older macOS)
2. Sign in with the Apple ID associated with the phone number
3. Open **Messages.app** and verify it shows "iMessage" in the title bar
4. Send a test message from Messages.app to confirm iMessage is active

### Configure BlueBubbles

1. Launch BlueBubbles Server
2. Set a server password (you will use this as `BLUEBUBBLES_PASSWORD`)
3. Note the server URL and port (default: `http://localhost:1234`)
4. Enable the **Private API** in BlueBubbles settings

### Verify BlueBubbles API

```bash
curl http://localhost:1234/api/v1/server/info?password=YOUR_BB_PASSWORD
```

You should see a JSON response with server info including the BlueBubbles version.

## 6. Deploy Application

### Clone the Repository

```bash
git clone YOUR_REPO_URL ~/bluebubbles-api
cd ~/bluebubbles-api
```

### Install Dependencies

```bash
npm install
```

### Configure Environment

```bash
cp .env.example .env.tyler_iphone
```

Edit the env file with production values:

```bash
nano .env.tyler_iphone
```

Set the following values:

| Variable | Value | Notes |
|----------|-------|-------|
| `BLUEBUBBLES_URL` | `http://localhost:1234` | Match your BB server port |
| `BLUEBUBBLES_PASSWORD` | Your BB password | Set during BB setup |
| `PORT` | `3000` | Or any available port |
| `NODE_ENV` | `production` | Enables API_KEY requirement |
| `LOG_LEVEL` | `info` | Use `debug` for troubleshooting |
| `ENABLE_PRETTY_LOGS` | `false` | JSON logs in production |
| `API_KEY` | A secure random string (16+ chars) | `openssl rand -hex 32` |
| `CRM_WEBHOOK_URL` | Tyler's CRM webhook endpoint | For inbound message relay |
| `ALERT_WEBHOOK_URL` | Tyler's alert endpoint | For downtime notifications |

### Build

```bash
npm run build
```

### Verify the Build

```bash
NODE_ENV=production node dist/server.js
```

You should see the server start on the configured port. Press `Ctrl+C` to stop.

## 7. PM2 Setup

PM2 keeps the service running and automatically restarts it on crash or reboot.

### Install PM2

```bash
npm install -g pm2
```

### Start the Application

```bash
cd ~/bluebubbles-api
pm2 start ecosystem.config.js
```

### Verify PM2 Status

```bash
pm2 status
```

You should see `bb-tyler-iphone` with status `online`.

### Check Logs

```bash
pm2 logs bb-tyler-iphone
```

### Configure PM2 to Survive Reboots

```bash
bash deploy/pm2-startup.sh
```

This runs `pm2 startup launchd` and `pm2 save` to persist the process list across macOS reboots.

### Verify PM2 Recovery

```bash
pm2 kill
pm2 resurrect
pm2 status
```

The `bb-tyler-iphone` process should come back online.

## 8. Nginx + SSL

Nginx acts as a reverse proxy, handling HTTPS termination and rate limiting.

### Install Nginx

```bash
brew install nginx
```

### Copy Configuration

```bash
cp deploy/nginx/bluebubbles-api.conf /opt/homebrew/etc/nginx/servers/bluebubbles-api.conf
```

### Edit Configuration

```bash
nano /opt/homebrew/etc/nginx/servers/bluebubbles-api.conf
```

Replace the placeholders:

- `__DOMAIN__` with your domain (e.g., `api.example.com`)
- `__PORT__` with your Express port (e.g., `3000`)

### Test Nginx Configuration

```bash
nginx -t
```

### Start Nginx

```bash
brew services start nginx
```

### Install Certbot and Obtain SSL Certificate

```bash
brew install certbot
sudo certbot --nginx -d YOUR_DOMAIN
```

Follow the prompts to obtain and install the SSL certificate.

### Uncomment SSL Lines

After certbot runs, verify the SSL certificate lines in the nginx config are uncommented:

```bash
nano /opt/homebrew/etc/nginx/servers/bluebubbles-api.conf
```

Ensure these lines are uncommented:

```nginx
ssl_certificate /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;
```

### Restart Nginx

```bash
nginx -t && brew services restart nginx
```

### Verify HTTPS

```bash
curl https://YOUR_DOMAIN/health
```

You should see a JSON health check response.

## 9. Verify Production

Run these checks to confirm everything is working:

### Health Check

```bash
curl https://YOUR_DOMAIN/health
```

Expected: JSON response with `status: "healthy"` and BlueBubbles connection info.

### Authenticated API Call

```bash
curl -X POST https://YOUR_DOMAIN/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to": "+1234567890", "message": "Test from production"}'
```

Expected: JSON response with `messageId` and `status: "queued"`.

### Check PM2 Logs for Errors

```bash
pm2 logs bb-tyler-iphone --lines 50
```

Look for any error-level log entries. Healthy logs show startup messages and request processing.

### Verify Nginx Access Logs

```bash
tail -20 /opt/homebrew/var/log/nginx/access.log
```

## 10. Ongoing Maintenance

### Log Rotation

PM2 handles its own log rotation. To configure:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### PM2 Monitoring

```bash
pm2 monit
```

This shows real-time CPU, memory, and log output for all PM2 processes.

### BlueBubbles Updates

- **Pin the BlueBubbles version** that is working in production
- Before updating: test the new version on a separate machine
- After updating: verify the BB REST API still responds and iMessage works
- Monitor the [BlueBubbles GitHub](https://github.com/BlueBubblesApp/bluebubbles-app) for breaking changes

### SSL Certificate Renewal

Certbot sets up automatic renewal. Verify the renewal timer:

```bash
sudo certbot renew --dry-run
```

Certificates auto-renew every 60-90 days. No manual action needed unless the dry-run fails.

### Restarting After macOS Updates

If macOS updates reboot the machine:

1. SSH back in
2. Verify BlueBubbles is running and iMessage is connected
3. Check PM2 status: `pm2 status`
4. Check nginx: `brew services list`
5. Verify health: `curl https://YOUR_DOMAIN/health`

---

*Last updated: 2026-03-30*
