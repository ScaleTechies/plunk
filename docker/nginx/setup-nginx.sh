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

first_non_empty() {
    for value in "$@"; do
        if [ -n "$value" ]; then
            printf '%s' "$value"
            return
        fi
    done
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

# Prefer Coolify's clean SERVICE_URL_* values. SERVICE_URL_*_80 is still
# accepted as a fallback because it is what creates the port-80 service mapping.
COOLIFY_API_URI="$(clean_url "$(first_non_empty "$SERVICE_URL_API" "$SERVICE_URL_API_80")")"
COOLIFY_DASHBOARD_URI="$(clean_url "$(first_non_empty "$SERVICE_URL_DASHBOARD" "$SERVICE_URL_DASHBOARD_80")")"
COOLIFY_LANDING_URI="$(clean_url "$(first_non_empty "$SERVICE_URL_LANDING" "$SERVICE_URL_LANDING_80")")"
COOLIFY_WIKI_URI="$(clean_url "$(first_non_empty "$SERVICE_URL_WIKI" "$SERVICE_URL_WIKI_80")")"

export NGINX_PORT="${NGINX_PORT:-80}"
export USE_HTTPS="${USE_HTTPS:-false}"

# Determine protocol based on USE_HTTPS
if [ "$USE_HTTPS" = "true" ]; then
    PROTOCOL="https"
else
    PROTOCOL="http"
fi

# Resolve public URLs. Explicit API_URI/DASHBOARD_URI/etc. are used for custom
# domains; Coolify-generated SERVICE_URL_* values are fallback defaults.
export API_URI="${API_URI:-${COOLIFY_API_URI}}"
export DASHBOARD_URI="${DASHBOARD_URI:-${COOLIFY_DASHBOARD_URI}}"
export LANDING_URI="${LANDING_URI:-${COOLIFY_LANDING_URI}}"
export WIKI_URI="${WIKI_URI:-${COOLIFY_WIKI_URI}}"

if [ -n "$COOLIFY_API_URI" ] && is_localhost_value "$API_URI"; then
    export API_URI="$COOLIFY_API_URI"
fi
if [ -n "$COOLIFY_DASHBOARD_URI" ] && is_localhost_value "$DASHBOARD_URI"; then
    export DASHBOARD_URI="$COOLIFY_DASHBOARD_URI"
fi
if [ -n "$COOLIFY_LANDING_URI" ] && is_localhost_value "$LANDING_URI"; then
    export LANDING_URI="$COOLIFY_LANDING_URI"
fi
if [ -n "$COOLIFY_WIKI_URI" ] && is_localhost_value "$WIKI_URI"; then
    export WIKI_URI="$COOLIFY_WIKI_URI"
fi

# Resolve nginx server names from explicit domain vars or from the final URLs.
export API_DOMAIN="${API_DOMAIN:-$(url_host "$API_URI")}"
export DASHBOARD_DOMAIN="${DASHBOARD_DOMAIN:-$(url_host "$DASHBOARD_URI")}"
export LANDING_DOMAIN="${LANDING_DOMAIN:-$(url_host "$LANDING_URI")}"
export WIKI_DOMAIN="${WIKI_DOMAIN:-$(url_host "$WIKI_URI")}"
export API_DOMAIN="${API_DOMAIN:-api.localhost}"
export DASHBOARD_DOMAIN="${DASHBOARD_DOMAIN:-app.localhost}"
export LANDING_DOMAIN="${LANDING_DOMAIN:-www.localhost}"
export WIKI_DOMAIN="${WIKI_DOMAIN:-docs.localhost}"

if [ -n "$API_URI" ] && is_localhost_value "$API_DOMAIN" && ! is_localhost_value "$API_URI"; then
    export API_DOMAIN="$(url_host "$API_URI")"
fi
if [ -n "$DASHBOARD_URI" ] && is_localhost_value "$DASHBOARD_DOMAIN" && ! is_localhost_value "$DASHBOARD_URI"; then
    export DASHBOARD_DOMAIN="$(url_host "$DASHBOARD_URI")"
fi
if [ -n "$LANDING_URI" ] && is_localhost_value "$LANDING_DOMAIN" && ! is_localhost_value "$LANDING_URI"; then
    export LANDING_DOMAIN="$(url_host "$LANDING_URI")"
fi
if [ -n "$WIKI_URI" ] && is_localhost_value "$WIKI_DOMAIN" && ! is_localhost_value "$WIKI_URI"; then
    export WIKI_DOMAIN="$(url_host "$WIKI_URI")"
fi

# Local fallback URLs.
export API_URI="${API_URI:-${PROTOCOL}://${API_DOMAIN}}"
export DASHBOARD_URI="${DASHBOARD_URI:-${PROTOCOL}://${DASHBOARD_DOMAIN}}"
export LANDING_URI="${LANDING_URI:-${PROTOCOL}://${LANDING_DOMAIN}}"
export WIKI_URI="${WIKI_URI:-${PROTOCOL}://${WIKI_DOMAIN}}"

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
