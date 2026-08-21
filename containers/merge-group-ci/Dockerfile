FROM docker.io/library/rust:1.96.0-bookworm@sha256:5e2214abe154fe26e39f64488952e5c991eeed1d6d6da7cc8381ae83927f0cfc

ARG TARGETARCH
ARG BUN_VERSION=1.4.0
ARG NODE_VERSION=22.23.2
ARG CARGO_AUDIT_VERSION=0.22.2
ARG GITLEAKS_VERSION=8.30.1
ARG ADVISORY_DB_COMMIT=42ead52aed439b170e1b8c8f9eab6735a93061d7
ARG SOURCE_DATE_EPOCH=1787270400

LABEL org.opencontainers.image.source="https://github.com/wordbricks/briar"
LABEL org.opencontainers.image.title="Briar merge-group CI"
LABEL org.opencontainers.image.description="Offline exact-SHA merge-group validation executor"
LABEL io.briar.merge-group-ci.protocol="1"
LABEL io.briar.rustsec-advisory-db="${ADVISORY_DB_COMMIT}"

RUN printf '%s\n' \
    'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260820T000000Z bookworm main' \
    'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260820T000000Z bookworm-updates main' \
    'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20260820T000000Z bookworm-security main' \
    > /etc/apt/sources.list \
  && rm -f /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git jq libappindicator3-dev librsvg2-dev \
    libssl-dev libwebkit2gtk-4.1-dev patchelf pkg-config unzip \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  case "${TARGETARCH}" in \
    arm64) \
      bun_asset="bun-linux-aarch64.zip"; \
      bun_sha="4b1a332ee861983eb93bcfe6f770fff94e3e31b2c388bdaea3c8ed35e58eed0e"; \
      node_arch="arm64"; \
      node_sha="fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8"; \
      audit_triple="aarch64-unknown-linux-gnu"; \
      audit_sha="c6603814ddaa45e51263dafd31c0ac98808f688d26f7395804f9670b0fd599dd"; \
      gitleaks_arch="arm64"; \
      gitleaks_sha="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080" \
      ;; \
    amd64) \
      bun_asset="bun-linux-x64.zip"; \
      bun_sha="2d03fb5fb83ac8b567aca0a281b2ce1a1a19d488f56c2968d88c3f25e92fe452"; \
      node_arch="x64"; \
      node_sha="d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307"; \
      audit_triple="x86_64-unknown-linux-gnu"; \
      audit_sha="ab28a1bdb54db4d5d8ad5981cf1f959410370b3d28250dbd35f6a44248620e39"; \
      gitleaks_arch="x64"; \
      gitleaks_sha="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb" \
      ;; \
    *) echo "unsupported OCI architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/bun.zip \
    "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${bun_asset}"; \
  echo "${bun_sha}  /tmp/bun.zip" | sha256sum -c -; \
  unzip -q /tmp/bun.zip -d /tmp/bun; \
  install -m 0755 "/tmp/bun/${bun_asset%.zip}/bun" /usr/local/bin/bun; \
  curl -fsSL -o /tmp/node.tar.xz \
    "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
  echo "${node_sha}  /tmp/node.tar.xz" | sha256sum -c -; \
  tar -xJf /tmp/node.tar.xz --strip-components=1 -C /usr/local; \
  curl -fsSL -o /tmp/cargo-audit.tgz \
    "https://github.com/RustSec/rustsec/releases/download/cargo-audit%2Fv${CARGO_AUDIT_VERSION}/cargo-audit-${audit_triple}-v${CARGO_AUDIT_VERSION}.tgz"; \
  echo "${audit_sha}  /tmp/cargo-audit.tgz" | sha256sum -c -; \
  tar -xzf /tmp/cargo-audit.tgz -C /tmp; \
  install -m 0755 \
    "/tmp/cargo-audit-${audit_triple}-v${CARGO_AUDIT_VERSION}/cargo-audit" \
    /usr/local/bin/cargo-audit; \
  curl -fsSL -o /tmp/gitleaks.tgz \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${gitleaks_arch}.tar.gz"; \
  echo "${gitleaks_sha}  /tmp/gitleaks.tgz" | sha256sum -c -; \
  tar -xzf /tmp/gitleaks.tgz -C /tmp gitleaks; \
  install -m 0755 /tmp/gitleaks /usr/local/bin/gitleaks; \
  rm -rf /tmp/bun /tmp/bun.zip /tmp/node.tar.xz /tmp/cargo-audit* /tmp/gitleaks*

RUN mkdir -p /opt/briar/cargo /opt/briar/rustup /opt/briar/bun-cache \
  && cp -a /usr/local/cargo/. /opt/briar/cargo/ \
  && cp -a /usr/local/rustup/. /opt/briar/rustup/

ENV CARGO_HOME=/opt/briar/cargo
ENV RUSTUP_HOME=/opt/briar/rustup
ENV BUN_INSTALL_CACHE_DIR=/opt/briar/bun-cache
ENV PATH=/opt/briar/cargo/bin:/usr/local/bin:/usr/bin:/bin
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

RUN rustup component add --toolchain 1.96.0 rustfmt clippy

WORKDIR /opt/briar/cache-source
COPY package.json bun.lock ./
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./src-tauri/
COPY src-tauri/build.rs ./src-tauri/build.rs
COPY src-tauri/src/lib.rs ./src-tauri/src/lib.rs

RUN bun --version | grep -Fx "${BUN_VERSION}" \
  && node --version | grep -Fx "v${NODE_VERSION}" \
  && cargo-audit --version | grep -Fx "cargo-audit ${CARGO_AUDIT_VERSION}" \
  && gitleaks version | grep -Fx "${GITLEAKS_VERSION}" \
  && bun install --frozen-lockfile --ignore-scripts \
  && bun audit --audit-level high --ignore GHSA-f88m-g3jw-g9cj \
  && sha256sum bun.lock > /opt/briar/audited-bun-lock.sha256 \
  && cargo fetch --locked --manifest-path src-tauri/Cargo.toml

RUN git clone --no-checkout https://github.com/RustSec/advisory-db.git \
      /opt/briar/cargo/advisory-db \
  && git -C /opt/briar/cargo/advisory-db checkout --detach "${ADVISORY_DB_COMMIT}" \
  && cargo audit --no-fetch --stale --file src-tauri/Cargo.lock

RUN chmod -R a+rX /opt/briar \
  && find /opt/briar -type d -exec chmod a-w {} + \
  && find /opt/briar -type f -exec chmod a-w {} +

USER 65532:65532
WORKDIR /scratch
CMD ["/bin/false"]
