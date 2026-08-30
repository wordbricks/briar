#![allow(non_camel_case_types)]

//! Generated Rust messages and Connect service descriptors for Briar-owned protocols.
//!
//! The checked-in files below are generated from
//! `packages/contracts/briar.contracts.image.binpb`.

mod descriptor_fingerprint;

pub use descriptor_fingerprint::CONTRACTS_DESCRIPTOR_FINGERPRINT;

// Buffa owns these checked-in implementations. Keep generator output untouched even when
// Clippy prefers derived enum defaults or simplified unknown-field decoder matches.
#[allow(clippy::derivable_impls, clippy::match_single_binding)]
pub mod proto {
    pub mod briar {
        pub mod local {
            pub mod v1 {
                include!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/src/gen/proto/briar.local.v1.rs"
                ));
            }
        }

        pub mod app {
            pub mod v1 {
                include!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/src/gen/proto/briar.app.v1.rs"
                ));
            }
        }

        pub mod realtime {
            pub mod v1 {
                include!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/src/gen/proto/briar.realtime.v1.rs"
                ));
            }
        }

        pub mod sidecar {
            pub mod v1 {
                include!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/src/gen/proto/briar.sidecar.v1.rs"
                ));
            }
        }

        pub mod types {
            pub mod v1 {
                include!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/src/gen/proto/briar.types.v1.rs"
                ));
            }
        }

        pub mod worker {
            pub mod v1 {
                include!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/src/gen/proto/briar.worker.v1.rs"
                ));
            }
        }
    }
}

// connect-rust generates exhaustive dispatcher shells whose empty streaming branches reduce
// to single-binding matches until a service declares a streaming RPC.
#[allow(clippy::match_single_binding)]
pub mod connect {
    pub mod briar {
        pub mod app {
            pub mod v1 {
                include!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/src/gen/connect/briar.app.v1.rs"
                ));
            }
        }

        pub mod worker {
            pub mod v1 {
                include!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/src/gen/connect/briar.worker.v1.rs"
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use buffa::Message;

    use crate::{connect, proto};

    #[test]
    fn generated_message_and_service_descriptors_are_usable() {
        let request = proto::briar::app::v1::ListProjectsRequest::default();
        let bytes = request.encode_to_vec();
        proto::briar::app::v1::ListProjectsRequest::decode_from_slice(&bytes)
            .expect("generated protobuf should round-trip");

        assert_eq!(
            connect::briar::app::v1::PROJECT_SERVICE_SERVICE_NAME,
            "briar.app.v1.ProjectService"
        );
        assert_eq!(
            connect::briar::worker::v1::WORKER_QUEUE_SERVICE_SERVICE_NAME,
            "briar.worker.v1.WorkerQueueService"
        );
    }
}
