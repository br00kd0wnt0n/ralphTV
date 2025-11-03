FROM debian:bullseye-slim
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx libnginx-mod-rtmp ca-certificates gettext-base && \
    rm -rf /var/lib/apt/lists/*

COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY entrypoint.sh /entrypoint.sh
COPY monitor-stream.sh /monitor-stream.sh
RUN chmod +x /entrypoint.sh /monitor-stream.sh

ENV NGINX_WORKER_PROCESSES=auto \
    RELAY_HTTP_PORT=8080 \
    RELAY_RTMP_PORT=1935 \
    RELAY_PUSH_1="" \
    RELAY_PUSH_2="" \
    RELAY_PUSH_3="" \
    RELAY_PUSH_4="" \
    RELAY_PUSH_5=""

EXPOSE 8080 1935

ENTRYPOINT ["/bin/bash","/entrypoint.sh"]
CMD ["nginx","-g","daemon off;"]

