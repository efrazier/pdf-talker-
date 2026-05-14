module.exports = {
  apps: [{
    name: 'pdf-talker',
    script: 'npm',
    args: 'start',
    interpreter: 'none',
    autorestart: true,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
