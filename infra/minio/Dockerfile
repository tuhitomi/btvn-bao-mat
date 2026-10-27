# MinIO CE no longer publishes official Docker Hub images. Build the official source.
# Pinned upstream RELEASE.2025-10-15T17-29-55Z, including its security fixes.
FROM golang:1.26-alpine@sha256:27f2d3b83cfc5803c8078f8e730af0f7c431bf067afaec8f60a36fb763187cba AS build
RUN apk add --no-cache git ca-certificates
RUN CGO_ENABLED=0 go install -trimpath github.com/minio/minio@9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a \
    && cp /go/pkg/mod/github.com/minio/minio@*/LICENSE /LICENSE.minio

FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
RUN apk add --no-cache ca-certificates curl tzdata \
    && addgroup -g 1000 minio && adduser -D -u 1000 -G minio minio \
    && mkdir /data && chown minio:minio /data
COPY --from=build /go/bin/minio /usr/local/bin/minio
COPY --from=build /LICENSE.minio /usr/share/licenses/minio/LICENSE
USER minio
EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
