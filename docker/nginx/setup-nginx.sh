#!/bin/sh
set -e

# Nginx Setup Script for Plunk
# Configures nginx reverse proxy with subdomain-based routing

echo "🔧 Configuring nginx reverse proxy..."

NGINX_CONFIG_DIR="/etc/nginx"
NGINX_CONF_D="${NGINX_CONFIG_DIR}/conf.d"

# Create nginx directories if they don't exist
mkdir -p "${NGINX_CONF_D}"

echo "🌐 Using subdomain-based routing"

clean_url() {
    printf '%s' "$1" | sed -E 's#^(https?://[^/:]+):(80|443)(/|$)#\1\3#'
}

url_host() {
    clean_url "$1" | sed -E 's#^https?://##; s#/.*$##; s#:[0-9]+$##'
}

first_non_empty() {
    for value in "$@"; do
        if [ -n "$value" ]; then
            printf '%s' "$value"
            return
        fi
    done
}

# Prefer Coolify's clean SERVICE_URL_* values. SERVICE_URL_*_80 is still
# accepted as a fallback because it is what creates the port-80 service mapping.
COOLIFY_API_URI="$(clean_url "$(first_non_empty "$SERVICE_URL_API" "$SERVICE_URL_API_80")")"
COOLIFY_DASHBOARD_URI="$(clean_url "$(first_non_empty "$SERVICE_URL_DASHBOARD" "$SERVICE_URL_DASHBOARD_80")")"
COOLIFY_LANDING_URI="$(clean_url "$(first_non_empty "$SERVICE_URL_LANDING" "$SERVICE_URL_LANDING_80")")"
COOLIFY_WIKI_URI="$(clean_url "$(first_non_empty "$SERVICE_URL_WIKI" "$SERVICE_URL_WIKI_80")")"

# Set defaults if not provided
export API_DOMAIN="${API_DOMAIN:-$(url_host "$COOLIFY_API_URI")}"
export DASHBOARD_DOMAIN="${DASHBOARD_DOMAIN:-$(url_host "$COOLIFY_DASHBOARD_URI")}"
export LANDING_DOMAIN="${LANDING_DOMAIN:-$(url_host "$COOLIFY_LANDING_URI")}"
export WIKI_DOMAIN="${WIKI_DOMAIN:-$(url_host "$COOLIFY_WIKI_URI")}"
export API_DOMAIN="${API_DOMAIN:-api.localhost}"
export DASHBOARD_DOMAIN="${DASHBOARD_DOMAIN:-app.localhost}"
export LANDING_DOMAIN="${LANDING_DOMAIN:-www.localhost}"
export WIKI_DOMAIN="${WIKI_DOMAIN:-docs.localhost}"

if [ -n "$COOLIFY_API_URI" ] && [ "$API_DOMAIN" = "api.localhost" ]; then
    export API_DOMAIN="$(url_host "$COOLIFY_API_URI")"
fi
if [ -n "$COOLIFY_DASHBOARD_URI" ] && [ "$DASHBOARD_DOMAIN" = "app.localhost" ]; then
    export DASHBOARD_DOMAIN="$(url_host "$COOLIFY_DASHBOARD_URI")"
fi
if [ -n "$COOLIFY_LANDING_URI" ] && [ "$LANDING_DOMAIN" = "www.localhost" ]; then
    export LANDING_DOMAIN="$(url_host "$COOLIFY_LANDING_URI")"
fi
if [ -n "$COOLIFY_WIKI_URI" ] && [ "$WIKI_DOMAIN" = "docs.localhost" ]; then
    export WIKI_DOMAIN="$(url_host "$COOLIFY_WIKI_URI")"
fi
export SMTP_DOMAIN="${SMTP_DOMAIN:-smtp.localhost}"
export NGINX_PORT="${NGINX_PORT:-80}"
export USE_HTTPS="${USE_HTTPS:-false}"

# Determine protocol based on USE_HTTPS
if [ "$USE_HTTPS" = "true" ]; then
    PROTOCOL="https"
else
    PROTOCOL="http"
fi

# Validate required environment variables
if [ -z "$API_DOMAIN" ] || [ -z "$DASHBOARD_DOMAIN" ] || [ -z "$LANDING_DOMAIN" ]; then
    echo "⚠️  Warning: Some domain variables are not set. Using defaults."
    echo "   API_DOMAIN=${API_DOMAIN}"
    echo "   DASHBOARD_DOMAIN=${DASHBOARD_DOMAIN}"
    echo "   LANDING_DOMAIN=${LANDING_DOMAIN}"
    echo "   WIKI_DOMAIN=${WIKI_DOMAIN}"
fi

# Auto-configure API URIs based on domains and protocol
export API_URI="${API_URI:-${COOLIFY_API_URI}}"
export DASHBOARD_URI="${DASHBOARD_URI:-${COOLIFY_DASHBOARD_URI}}"
export LANDING_URI="${LANDING_URI:-${COOLIFY_LANDING_URI}}"
export WIKI_URI="${WIKI_URI:-${COOLIFY_WIKI_URI}}"
export API_URI="${API_URI:-${PROTOCOL}://${API_DOMAIN}}"
export DASHBOARD_URI="${DASHBOARD_URI:-${PROTOCOL}://${DASHBOARD_DOMAIN}}"
export LANDING_URI="${LANDING_URI:-${PROTOCOL}://${LANDING_DOMAIN}}"
export WIKI_URI="${WIKI_URI:-${PROTOCOL}://${WIKI_DOMAIN}}"

# Generate nginx configuration from template
echo "📝 Generating nginx configuration..."

# If SMTP_DOMAIN is not set or empty, use a placeholder to prevent nginx config errors
if [ -z "$SMTP_DOMAIN" ]; then
    echo "⚠️  SMTP_DOMAIN not set - ACME challenge proxy will not be configured"
    export SMTP_DOMAIN="_"  # nginx wildcard that won't match any real domain
fi

envsubst '${NGINX_PORT} ${API_DOMAIN} ${DASHBOARD_DOMAIN} ${LANDING_DOMAIN} ${WIKI_DOMAIN} ${SMTP_DOMAIN}' \
    < /app/docker/nginx/nginx.conf.template \
    > "${NGINX_CONF_D}/plunk.conf"

# Always create nginx.conf (overwrite default from package)
cat > "${NGINX_CONFIG_DIR}/nginx.conf" << 'EOF'
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_names_hash_bucket_size 128;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;

    # Include server configurations
    include /etc/nginx/conf.d/*.conf;
}
EOF

echo "✅ Nginx configuration complete!"
echo "   Config file: ${NGINX_CONF_D}/plunk.conf"
echo "   API Domain: ${API_DOMAIN}"
echo "   Dashboard Domain: ${DASHBOARD_DOMAIN}"
echo "   Landing Domain: ${LANDING_DOMAIN}"
echo "   Wiki Domain: ${WIKI_DOMAIN}"
echo "   SMTP Domain: ${SMTP_DOMAIN}"
