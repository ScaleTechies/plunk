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

resolve_uri() {
    value="$1"
    fallback_host="$2"

    clean_url "${value:-${PROTOCOL}://${fallback_host}}"
}

resolve_domain() {
    uri="$1"
    fallback_domain="$2"

    resolved_domain="$(url_host "$uri")"
    printf '%s' "${resolved_domain:-$fallback_domain}"
}

is_localhost_value() {
    case "$1" in
        ""|localhost|*.localhost|http://localhost*|https://localhost*|http://*.localhost*|https://*.localhost*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

infer_smtp_from_domain() {
    domain="$1"

    case "$domain" in
        api.*) printf 'smtp.%s' "${domain#api.}" ;;
        dashboard.*) printf 'smtp.%s' "${domain#dashboard.}" ;;
        app.*) printf 'smtp.%s' "${domain#app.}" ;;
        landing.*) printf 'smtp.%s' "${domain#landing.}" ;;
        www.*) printf 'smtp.%s' "${domain#www.}" ;;
        wiki.*) printf 'smtp.%s' "${domain#wiki.}" ;;
        docs.*) printf 'smtp.%s' "${domain#docs.}" ;;
        api-*) printf 'smtp-%s' "${domain#api-}" ;;
        dashboard-*) printf 'smtp-%s' "${domain#dashboard-}" ;;
        app-*) printf 'smtp-%s' "${domain#app-}" ;;
        landing-*) printf 'smtp-%s' "${domain#landing-}" ;;
        wiki-*) printf 'smtp-%s' "${domain#wiki-}" ;;
        docs-*) printf 'smtp-%s' "${domain#docs-}" ;;
    esac
}

infer_smtp_domain() {
    for domain in "$@"; do
        if [ -n "$domain" ] && ! is_localhost_value "$domain"; then
            inferred="$(infer_smtp_from_domain "$domain")"
            if [ -n "$inferred" ]; then
                printf '%s' "$inferred"
                return
            fi
        fi
    done
}

export NGINX_PORT="${NGINX_PORT:-80}"
export USE_HTTPS="${USE_HTTPS:-false}"

# Determine protocol based on USE_HTTPS
if [ "$USE_HTTPS" = "true" ]; then
    PROTOCOL="https"
else
    PROTOCOL="http"
fi

# Resolve public URLs. Coolify deployments must provide these explicitly via
# docker-compose.yml; localhost defaults only support direct local runs.
export API_URI="$(resolve_uri "$API_URI" "api.localhost")"
export DASHBOARD_URI="$(resolve_uri "$DASHBOARD_URI" "app.localhost")"
export LANDING_URI="$(resolve_uri "$LANDING_URI" "www.localhost")"
export WIKI_URI="$(resolve_uri "$WIKI_URI" "docs.localhost")"

# Resolve nginx server names from the final URLs. Domain env vars are
# intentionally ignored so stale Coolify variables cannot override *_URI.
export API_DOMAIN="$(resolve_domain "$API_URI" "api.localhost")"
export DASHBOARD_DOMAIN="$(resolve_domain "$DASHBOARD_URI" "app.localhost")"
export LANDING_DOMAIN="$(resolve_domain "$LANDING_URI" "www.localhost")"
export WIKI_DOMAIN="$(resolve_domain "$WIKI_URI" "docs.localhost")"

# SMTP is TCP, not a Coolify HTTP route. Set SMTP_DOMAIN explicitly when the
# relay should use a different hostname than the inferred one.
export SMTP_DOMAIN="${SMTP_DOMAIN:-}"
if is_localhost_value "$SMTP_DOMAIN"; then
    export SMTP_DOMAIN=""
fi
export SMTP_DOMAIN="${SMTP_DOMAIN:-$(infer_smtp_domain "$API_DOMAIN" "$DASHBOARD_DOMAIN" "$LANDING_DOMAIN" "$WIKI_DOMAIN")}"
export NGINX_SMTP_DOMAIN="${SMTP_DOMAIN:-_}"

# Validate required environment variables
if [ -z "$API_DOMAIN" ] || [ -z "$DASHBOARD_DOMAIN" ] || [ -z "$LANDING_DOMAIN" ]; then
    echo "⚠️  Warning: Some domain variables are not set. Using defaults."
    echo "   API_DOMAIN=${API_DOMAIN}"
    echo "   DASHBOARD_DOMAIN=${DASHBOARD_DOMAIN}"
    echo "   LANDING_DOMAIN=${LANDING_DOMAIN}"
    echo "   WIKI_DOMAIN=${WIKI_DOMAIN}"
fi

# Generate nginx configuration from template
echo "📝 Generating nginx configuration..."

# If SMTP_DOMAIN is not set, use a placeholder to prevent nginx config errors.
if [ "$NGINX_SMTP_DOMAIN" = "_" ]; then
    echo "⚠️  SMTP_DOMAIN not set - ACME challenge proxy will not be configured"
fi

envsubst '${NGINX_PORT} ${API_DOMAIN} ${DASHBOARD_DOMAIN} ${LANDING_DOMAIN} ${WIKI_DOMAIN} ${NGINX_SMTP_DOMAIN}' \
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
echo "   SMTP Domain: ${SMTP_DOMAIN:-not configured}"
