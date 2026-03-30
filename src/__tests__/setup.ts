// Set required env vars before any module imports trigger env validation
process.env['BLUEBUBBLES_URL'] = 'http://localhost:1234';
process.env['BLUEBUBBLES_PASSWORD'] = 'test-password';
process.env['PORT'] = '3000';
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'error';
process.env['ENABLE_PRETTY_LOGS'] = 'false';
process.env['DEFAULT_COUNTRY_CODE'] = 'US';
