export default {
  apps: [
    {
      name: 'bb-tyler-iphone',
      script: 'dist/server.js',
      env_file: '.env.tyler_iphone',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      watch: false,
      max_memory_restart: '256M',
    },
    // Add more instances per phone number:
    // {
    //   name: 'bb-tyler-android',
    //   script: 'dist/server.js',
    //   env_file: '.env.tyler_android',
    //   instances: 1,
    //   autorestart: true,
    //   max_memory_restart: '256M',
    // },
  ],
};
