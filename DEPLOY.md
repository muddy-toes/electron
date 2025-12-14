# Deployment Guide

This guide covers deploying Electron to various cloud providers.

## Prerequisites

- Node.js 18+ (20 recommended)
- npm or yarn
- Git (for version tracking)

## Environment Variables

| Variable   | Default | Description                         |
|------------|---------|-------------------------------------|
| `PORT`     | `5000`  | Server listen port                  |
| `NODE_ENV` | -       | Set to `production` for deployments |

For additional configuration, create a `config.js` file based on `config.js-dist`.

## Important: SQLite Persistence

Electron uses SQLite for session state. Most cloud platforms have **ephemeral filesystems** - data is lost on redeploy. You need persistent storage for:

- `electron-state.sqlite3` (and `-wal`, `-shm` files)
- `saved_sessions/` (if enabled in config)
- `session_files/` (if using playlist driver)

Each deployment method below addresses this requirement.

---

## Docker (Self-Hosted)

Best for: VPS, dedicated servers, self-hosted infrastructure.

### Quick Start

```bash
# Build and run
docker build -t electron .
docker run -p 5000:5000 -v electron-data:/app/data electron
```

### With Docker Compose

```bash
# Start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Custom Configuration

Mount your config file:

```bash
docker run -p 5000:5000 \
  -v electron-data:/app/data \
  -v ./config.js:/app/config.js:ro \
  electron
```

Or edit `docker-compose.yml` to uncomment the config volume.

### HTTPS with Docker

Use a reverse proxy like Traefik, nginx, or Caddy:

**With Caddy (automatic HTTPS):**

```bash
# Caddyfile
your-domain.com {
    reverse_proxy electron:5000
}
```

**With nginx:**

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Fly.io

Best for: Global deployment, automatic scaling, WebSocket support.

### Setup

1. Install the Fly CLI: https://fly.io/docs/hands-on/install-flyctl/

2. Login:
   ```bash
   fly auth login
   ```

3. Create the app (first time only):
   ```bash
   fly launch
   ```
   - Choose a unique app name
   - Select your preferred region
   - Say "No" to databases

4. Create a persistent volume:
   ```bash
   fly volumes create electron_data --size 1 --region iad
   ```
   Replace `iad` with your chosen region.

5. Update `fly.toml` with your app name.

6. Deploy:
   ```bash
   fly deploy
   ```

### Custom Configuration

Set secrets for sensitive config:
```bash
fly secrets set SOME_SECRET=value
```

### HTTPS

Fly.io provides automatic HTTPS. Your app will be available at:
- `https://your-app-name.fly.dev`

For custom domains:
```bash
fly certs create your-domain.com
```
Then add DNS records as instructed.

---

## Render

Best for: Simple deploys, automatic builds from Git.

### Setup

1. Create a Render account: https://render.com

2. Connect your GitHub/GitLab repository

3. Create a new Web Service:
   - Choose your repo
   - Render will detect `render.yaml` automatically

4. **Important**: The blueprint creates a 1GB disk. Adjust in `render.yaml` if needed.

### Manual Setup (Without Blueprint)

1. Create a new Web Service
2. Set:
   - **Build Command**: `npm ci --only=production`
   - **Start Command**: `node index.js`
   - **Environment**: `NODE_ENV=production`, `PORT=5000`
3. Add a Disk:
   - **Mount Path**: `/app/data`
   - **Size**: 1 GB

### HTTPS

Render provides automatic HTTPS on `*.onrender.com` domains.

For custom domains:
1. Go to Settings > Custom Domains
2. Add your domain
3. Configure DNS as instructed
4. SSL certificate is provisioned automatically

---

## Railway

Best for: Easy deploys, good free tier.

### Setup

1. Create a Railway account: https://railway.app

2. Create a new project from GitHub

3. Railway auto-detects Node.js and deploys

4. **Add persistent storage**:
   - Go to your service
   - Click "Add Volume"
   - Set mount path to `/app/data`

### Environment Variables

Set in the Railway dashboard:
- `NODE_ENV=production`
- `PORT=5000` (Railway sets this automatically)

### HTTPS

Railway provides automatic HTTPS. Generate a domain:
1. Go to Settings > Domains
2. Click "Generate Domain"

For custom domains, add them in the same section.

---

## Heroku

**Warning**: Heroku's filesystem is ephemeral. Session data will be lost on each deploy or dyno restart. For production use with Heroku, consider migrating to PostgreSQL.

### Setup

1. Install Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli

2. Login:
   ```bash
   heroku login
   ```

3. Create app:
   ```bash
   heroku create your-app-name
   ```

4. Deploy:
   ```bash
   git push heroku main
   ```

### Deploy Button

Add this to your README for one-click deploys:

```markdown
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)
```

### HTTPS

Heroku provides automatic HTTPS on `*.herokuapp.com`.

For custom domains:
```bash
heroku domains:add your-domain.com
```
Then configure DNS. SSL is automatic with ACM.

---

## Configuration Tips

### Using config.js in Production

For platforms supporting file mounts (Docker, Fly.io):
1. Create your `config.js` locally
2. Mount it into the container

For platforms without file mounts (Railway, Render, Heroku):
1. Use environment variables where possible
2. Or include a production `config.js` in your repo (be careful with secrets!)

### Database Path for Persistent Storage

When using mounted volumes, update `config.js` to store the database in the mounted directory:

```javascript
module.exports = {
    dbPath: '/app/data/electron-state.sqlite3',
    savedSessionsPath: '/app/data/saved_sessions',
    // ... other config
};
```

### WebSocket Considerations

All platforms listed support WebSockets. Ensure:
- Connection timeouts are adequate (Socket.IO handles reconnection)
- If using a reverse proxy, configure it for WebSocket upgrade
- Fly.io: `auto_stop_machines = false` keeps the app running for persistent connections

---

## Monitoring

### Health Checks

The app serves the home page at `/` which can be used for health checks. All deployment configs include this.

### Logs

- **Docker**: `docker logs <container>` or `docker-compose logs -f`
- **Fly.io**: `fly logs`
- **Render**: Dashboard > Logs
- **Railway**: Dashboard > Deployments > Logs
- **Heroku**: `heroku logs --tail`

---

## Troubleshooting

### Native Module Build Failures

`better-sqlite3` requires compilation. If builds fail:
- Ensure Python 3, make, and g++ are available
- The Dockerfile handles this in the builder stage
- For Heroku/Railway, buildpacks usually include these

### WebSocket Connection Issues

If WebSocket connections fail:
1. Check that HTTPS is properly configured
2. Ensure your reverse proxy (if any) supports WebSocket upgrade
3. Check for firewall rules blocking WebSocket ports

### Database Locked Errors

SQLite uses WAL mode for better concurrency. If you see lock errors:
- Ensure only one instance is running
- Check that the volume mount is working correctly
- Verify write permissions on the data directory
