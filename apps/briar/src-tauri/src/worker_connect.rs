use connectrpc::client::{ClientConfig, HttpClient};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use rustls_platform_verifier::BuilderVerifierExt as _;
use std::{sync::Arc, time::Duration};

const WORKER_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// Build the shared transport and defaults consumed directly by generated
/// Connect clients. Service-specific methods belong to generated code, not a
/// parallel Briar client facade.
pub(super) fn authenticated_worker_connect(
    api_url: &str,
    token: &str,
) -> Result<(HttpClient, ClientConfig), String> {
    let api_url = reqwest::Url::parse(api_url.trim())
        .map_err(|error| format!("Worker Connect API URL이 올바르지 않습니다: {error}"))?;
    if !api_url.username().is_empty()
        || api_url.password().is_some()
        || api_url.query().is_some()
        || api_url.fragment().is_some()
    {
        return Err(
            "Worker Connect API URL에 인증 정보, query, fragment를 넣을 수 없습니다.".to_string(),
        );
    }

    let transport = match api_url.scheme() {
        "http" => HttpClient::plaintext(),
        "https" => {
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            let tls = rustls::ClientConfig::builder_with_provider(provider)
                .with_safe_default_protocol_versions()
                .map_err(|error| format!("Worker Connect TLS 버전을 설정하지 못했습니다: {error}"))?
                .with_platform_verifier()
                .map_err(|error| format!("Worker Connect TLS 검증기를 만들지 못했습니다: {error}"))?
                .with_no_client_auth();
            HttpClient::with_tls(Arc::new(tls))
        }
        _ => return Err("Worker Connect API URL은 http 또는 https여야 합니다.".to_string()),
    };

    let token = token.trim();
    if token.is_empty() {
        return Err("Worker Connect 인증 토큰이 비어 있습니다.".to_string());
    }
    let authorization = HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| "Worker Connect 인증 토큰을 HTTP header로 만들 수 없습니다.".to_string())?;
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, authorization);

    let base_uri = api_url
        .as_str()
        .parse()
        .map_err(|error| format!("Worker Connect base URI를 만들지 못했습니다: {error}"))?;
    let config = ClientConfig::new(base_uri)
        .proto()
        .with_default_timeout(WORKER_CONNECT_TIMEOUT)
        .with_default_headers(headers);
    Ok((transport, config))
}

#[cfg(test)]
mod tests {
    use super::*;
    use connectrpc::{CodecFormat, Protocol};

    #[test]
    fn configures_generated_clients_with_binary_connect_and_fail_closed_auth() {
        let (_, config) =
            authenticated_worker_connect("https://briar.example.com/api/", "briar_agent_test")
                .expect("authenticated client config should be valid");

        assert_eq!(
            config.base_uri().to_string(),
            "https://briar.example.com/api/"
        );
        assert_eq!(config.protocol(), Protocol::Connect);
        assert_eq!(config.codec_format(), CodecFormat::Proto);
        assert_eq!(config.default_timeout(), Some(WORKER_CONNECT_TIMEOUT));
        assert_eq!(
            config.default_headers().get(AUTHORIZATION),
            Some(&HeaderValue::from_static("Bearer briar_agent_test"))
        );

        assert!(authenticated_worker_connect("ftp://briar.example.com", "token").is_err());
        assert!(authenticated_worker_connect("https://briar.example.com", "\n").is_err());
    }
}
