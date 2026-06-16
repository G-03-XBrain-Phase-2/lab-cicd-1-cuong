const express = require('express');
const client = require('prom-client');

const app = express();
const port = process.env.PORT || 3000;

// Retrieve DB password from environment (injected via Sealed Secret)
const dbPassword = process.env.DATABASE_PASSWORD || 'NOT_FOUND_SECURE_PASSWORD';

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// Custom metric: HTTP request duration histogram
const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
});
register.registerMetric(httpRequestDurationMicroseconds);

let isHealthy = true;

// Middleware to record request metrics
app.use((req, res, next) => {
  const end = httpRequestDurationMicroseconds.startTimer();
  res.on('finish', () => {
    if (req.path === '/' || req.path === '/healthz') {
      end({ method: req.method, route: req.path, code: res.statusCode });
    }
  });
  next();
});

app.get('/', (req, res) => {
  if (!isHealthy) {
    return res.status(500).send('Application is failing (simulated error)\n');
  }
  const isSecretConfigured = dbPassword !== 'NOT_FOUND_SECURE_PASSWORD';
  res.send(`Hello from the Canary Demo App! Version: ${process.env.VERSION || '1.0.0'} | Secret Loaded: ${isSecretConfigured ? 'YES (Encrypted via SealedSecret)' : 'NO (Fallback)'}\n`);
});

app.get('/fail', (req, res) => {
  isHealthy = false;
  console.log('ALERT: Received fail trigger. App is now returning 500.');
  res.send('Health status set to FAILING. Subsequent requests to / will return 500.\n');
});

app.get('/reset', (req, res) => {
  isHealthy = true;
  console.log('INFO: Received reset trigger. App is now healthy.');
  res.send('Health status set to HEALTHY. App is returning 200.\n');
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});

app.get('/healthz', (req, res) => {
  if (!isHealthy) {
    return res.status(500).send('Unhealthy\n');
  }
  res.send('Healthy\n');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
