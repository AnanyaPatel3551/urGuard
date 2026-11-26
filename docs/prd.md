# Product Requirements Document (PRD): urGuard

**Project Name:** urGuard — Post-Quantum Zero-Trust Messaging, Key Lifecycle & Explainable Access Guard  
**Hackathon Track:** Track 4 — *"Trust, but verify"* (Post-Quantum Cryptography, Identity & Access Control)  
**Target Stack:** Go (1.24+) + ConnectRPC / gRPC + React + TypeScript  
**Compliance Constraints:** Vetted standardized PQC libraries only (`crypto/mlkem`, `cloudflare/circl`); **zero AI/ML components**; **zero custom cryptographic primitives**; **zero hard-coded secrets**; deterministic clean-machine builds.

---

## 1. Executive Summary & USP

**urGuard** is an end-to-end post-quantum protected messaging/file-transfer platform paired with an explainable, tamper-evident identity and access monitoring control plane.

### Unique Selling Proposition (USP)
1. **Hybrid Post-Quantum E2E + Transport Security:** Combines hybrid transport (`X25519MLKEM768` TLS) with application-layer hybrid envelope encryption (`X25519 + ML-KEM-768` + `HKDF-SHA256` + `AES-256-GCM`) and `ML-DSA-65` signatures—ensuring confidentiality, forward secrecy, and recipient binding even if transport terminates or long-term identity keys are later exposed.
2. **Crash-Safe, Multi-Node Key Governance:** Key rotation and revocation operate over a persistent two-phase WAL state machine (`bbolt` / pure-Go SQLite) with sub-second gRPC streaming propagation across nodes, cryptographic backup verification, and injection-proof hash-chained audit logs.
3. **Explainable Graph + Statistical Detection (Zero AI/ML):** Real-time lateral movement and privilege-escalation detection using directed access graphs, context-aware policy rules, and bounded-watermark clock-skew handling—delivering human-auditable alert paths and exact F1 / alert-latency metrics.

---

## 2. System Architecture Overview

```text
+-------------------------------------------------------------------+
|                 React + TypeScript Operator Console               |
|  - E2E Secure Messaging / File Transfer Demo Client               |
|  - Key Lifecycle, Rotation, Revocation & Re-Enrollment Controls   |
|  - Tamper-Evident Audit Log Viewer & Chain Integrity Verifier     |
|  - Live Alert Feed, Service-Identity Graph & Detection Metrics    |
+---------------------------------+---------------------------------+
                                  | ConnectRPC (HTTP/JSON & gRPC-Web)
+---------------------------------v---------------------------------+
|              Control Plane & Detection Engine (Go)                |
|  +------------------+  +------------------+  +-----------------+  |
|  | Identity & ACL   |  | Key Authority    |  | Tamper-Evident  |  |
|  | Policy Evaluator |  | (Rotation/CRL/   |  | Hash-Chained    |  |
|  |                  |  |  Backup/Recovery)|  | Audit Log (DSA) |  |
|  +--------+---------+  +--------+---------+  +--------+--------+  |
|           |                     |                     |           |
|  +--------v---------------------v---------------------v--------+  |
|  |  Explainable Detector: Watermark Buffer + Rule Engine +     |  |
|  |  Identity-Service Access Graph (Lateral Movement)           |  |
|  +-------------------------------------------------------------+  |
+---------------------------------+---------------------------------+
                                  | gRPC Server-Streaming (PQC-mTLS)
         +------------------------+------------------------+
         |                                                 |
+--------v------------------+                   +----------v----------------+
| Storage/Relay Node A (Go) |                   | Storage/Relay Node B (Go) |
| - Local Key/CRL Epoch DB  |                   | - Local Key/CRL Epoch DB  |
| - E2E Envelope Relay      |                   | - E2E Envelope Relay      |
| - Chunk Reassembly & MAC  |                   | - Chunk Reassembly & MAC  |
| - Session Resumption Gate |                   | - Session Resumption Gate |
+---------------------------+                   +---------------------------+
```

---

## 3. Functional & Security Requirements (Track 4 Checklist)

### FR-1: Hybrid Post-Quantum Cryptography & E2E Protection
* **Primitives (Vetted Only):**
  * Key Encapsulation: Hybrid `X25519 + ML-KEM-768` (`crypto/mlkem` / `cloudflare/circl`).
  * Signatures: `ML-DSA-65` (`cloudflare/circl/sign/mldsa/mldsa65`).
  * Symmetric AEAD & KDF: `AES-256-GCM` and `HKDF-SHA256` (Go `crypto/aes`, `crypto/cipher`, `golang.org/x/crypto/hkdf`).
  * Transport: `crypto/tls` with `X25519MLKEM768` + mutual authentication between internal nodes.
* **Key Hierarchy:**
  * **Long-Term Identity Key (`IK_sig`):** `ML-DSA-65` signing keypair bound to user/service identity and device ID.
  * **Pre-Key / Epoch Encryption Key (`EK_epoch`):** `X25519 + ML-KEM-768` keypair rotated on schedule or manually.
  * **Ephemeral Session Key (`SK_ephem`):** Freshly generated per session/transfer; zeroized immediately after key derivation/completion.

### FR-2: Key Rotation & Grace Period Policy
* **Mechanism:** Two-phase atomic rotation (`IDLE` → `PREPARING` → `COMMITTED` → `CUTOFF_ENFORCED`).
* **Grace Period Specification:**
  * Explicit configurable grace period (default: **`grace_period_seconds = 30`**) starting at `t_commit`.
  * **During Grace Period (`t_commit <= t < t_cutoff`):** Nodes issue new transfers under `epoch + 1`, while permitting **already-authorized in-flight transfers** referencing `epoch` to complete.
  * **After Cutoff (`t >= t_cutoff`):** Every node strictly **rejects** any new request using `epoch` or older with `ERR_KEY_EPOCH_EXPIRED` and emits an audit event.
* **Non-Disruption:** Authorized active transfers continue seamlessly across rotation boundaries.

### FR-3: Multi-Node Revocation & Device Loss Re-Enrollment
* **Propagation:** Control plane pushes signed Revocation Lists (`CRL_epoch`, `revoked_key_id`, `revoked_device_id`, `issued_at`) via **gRPC Server-Streaming** to all nodes, backed by a 1s heartbeat reconciliation check.
* **Enforced Metric:** System records `t_revoked` (control plane commit) and `t_enforced_last_node` (ack from final node) and exposes `revocation_propagation_ms`.
* **Device Loss & Re-Enrollment:**
  * Owner revokes lost device key (`device_old`) and authenticates via secondary recovery / admin-approved enrollment flow to register `device_new`.
  * Shared file/channel Data Encryption Keys (DEKs) are **re-encapsulated** to the active authorized devices (including `device_new`, excluding `device_old`) so existing collaborators retain uninterrupted access without re-uploading plaintext.

### FR-4: Crash Recovery
* **WAL State Machine:** All key rotations and revocations write intent and state transitions atomically to `bbolt` (or pure-Go SQLite in `WAL` mode with `synchronous=FULL`) before acknowledging or streaming.
* **Interrupted Rotation Behavior:** If the control plane or a node is killed (`SIGKILL`) during `PREPARING`:
  * On restart, uncommitted `PREPARING` epochs are either cleanly rolled back or completed deterministically based on quorum/WAL state—never leaving a half-active or unauthorized key version.
  * **Revoked Keys Stay Revoked:** Revocation records are stored in a monotonic append-only revocation bucket (`crl_epoch` strictly increasing); crash recovery never restores a revoked key.
  * Committed epochs and previously encrypted messages/files remain readable.

### FR-5: Backup Integrity
* **Export Format:** Encrypted backup bundle containing:
  * Header: `format_version`, `backup_id`, `created_at`, `key_epoch`, `sha256_manifest`
  * Ciphertext: `AES-256-GCM` encrypted key store (keyed via operator backup passphrase / KEK via Argon2id + HKDF)
  * Signature: `ML-DSA-65` signature over `Header || Ciphertext`
* **Verification on Restore:**
  * Verify `ML-DSA-65` signature, `AES-GCM` authentication tag, and `sha256_manifest` before mutating any live state.
  * Any bit-flip, truncation, rollback, or unsigned payload immediately aborts restore, returns `ERR_BACKUP_CORRUPTED`, leaves live key material untouched, and writes a `BACKUP_INTEGRITY_FAILURE` event.

### FR-6: Tamper-Evident & Injection-Proof Audit Log
* **Injection Prevention:**
  * Events are strictly serialized using canonical JSON (fixed sorted keys, length/type-checked strings) or deterministic Protobuf binary framing—never string-formatted log lines.
  * User-supplied fields (e.g., filenames, display names, messages, metadata strings) are isolated inside escaped value fields (`payload.metadata`) and **cannot** inject newlines, alter `actor_id`, `action`, or split a record boundary.
* **Cryptographic Integrity:**
  * Each record stores `seq`, `prev_hash`, `canonical_body`, and `entry_hash = SHA256(seq || prev_hash || canonical_body)`.
  * Control plane signs periodic checkpoints (`checkpoint_seq`, `entry_hash`, `timestamp`) with `ML-DSA-65`.
* **Verification Endpoint & CLI:** Operators can run `VerifyLogChain()` via API, CLI, or UI to detect any modified, deleted, inserted, or reordered record and pinpoint the exact broken `seq`.

### FR-7: Replay Protection & Recipient Binding
* **Envelope Authentication:** Every message/file header contains `sender_id`, `recipient_id`, `session_id`, `key_epoch`, `msg_seq`, `nonce`, and `timestamp`.
* **AAD Binding:** `AES-256-GCM` Additional Authenticated Data (AAD) includes `canonical(sender_id || recipient_id || session_id || key_epoch || msg_seq)`.
* **Signature:** Sender signs `SHA256(AAD || ciphertext)` with `IK_sig` (`ML-DSA-65`).
* **Enforcement:**
  * Modifying `recipient_id` (or forwarding a message encrypted for Alice to Bob) fails both AEAD tag verification and signature recipient-binding check (`ERR_RECIPIENT_MISMATCH`).
  * Receiver persists a sliding replay window / seen-ID cache keyed by `(session_id, sender_id, msg_seq)` and rejects duplicates (`ERR_REPLAY_DETECTED`).

### FR-8: Forward Secrecy
* Each session/message exchange establishes a fresh ephemeral shared secret via `X25519 + ML-KEM-768` (`SK_ephem`), mixed via `HKDF-SHA256` with session transcript context, and zeroizes ephemeral private scalars (`mlkem` decapsulation key / `X25519` secret) immediately after session key derivation and message completion.
* Exposing a user's long-term `IK_sig` or rotated-out `EK_epoch` after a session completes cannot decrypt recorded ciphertexts from earlier completed sessions.

### FR-9: Delivery Under Loss or Reordering
* Large messages/files are split into indexed chunks (`chunk_index`, `total_chunks`, `transfer_id`, `chunk_hash`, `root_manifest_hash`) each AEAD-encrypted and authenticated.
* **Reordering:** Receiver buffers out-of-order chunks by `chunk_index` within a bounded transfer window and assembles them in order once all chunks (`0..total_chunks-1`) pass AEAD + `root_manifest_hash` verification.
* **Loss / Corruption:** Missing chunks past transfer timeout or corrupted chunks fail manifest verification; receiver **discards** incomplete/unauthenticated payloads (never exposes partial plaintext) and emits an explicit `DELIVERY_FAILED` status + audit event.

### FR-10: Session Resumption Binding
* Session resumption issues an authenticated `ResumptionTicket` encrypted with the server/cluster ticket key (`AES-256-GCM`) containing `session_id`, `authenticated_peer_id`, `peer_ik_fingerprint`, `issued_at`, and `expires_at`.
* On resume, the client must present the ticket **and** an `ML-DSA-65` signature over a fresh server-issued `resume_challenge` + `session_id`.
* If a different identity presents a stolen/copied `session_id` or `ResumptionTicket`, signature/peer verification fails (`ERR_SESSION_IDENTITY_MISMATCH`), the resume is rejected, and a `SESSION_HIJACK_ATTEMPT` alert is raised.

### FR-11: Explainable Routine vs. Suspicious Activity Detection
* **Zero AI/ML Constraint:** Strictly deterministic rules, statistical baselines (EWMA / z-score / frequency thresholds), and graph traversal.
* **Context-Aware Classification:**
  * Evaluates `(identity, role, action, target_service, change_ticket/maintenance_window, timestamp, source_node)`.
  * Routine admin tasks (e.g., key rotation during approved maintenance window with valid admin role + change context) are classified as `BENIGN_ADMIN`.
  * Unexpected privilege grants (`ROLE_GRANT`, `ACL_ESCALATE` outside approved context, self-escalation, dormant-account activation, sudden burst of sensitive file reads) trigger explainable alerts.
* **Required Output Metrics:** Automated evaluation harness computes and outputs on labeled synthetic logs:
  * **Precision / Recall / F1 Score**
  * **Median Time to Alert (ms)**
  * **False Alerts per 1,000 Benign Events**

### FR-12: Lateral Movement Detection
* **Access Graph Model:** Builds an in-memory directed multigraph `G = (V, E)` where nodes are `identities` and `services/resources`, and edges track observed `(identity -> source_service -> target_service)` transitions with baseline edge counts.
* **Detection Rules:** Flags unusual cross-service paths even when credentials/tokens are valid:
  1. **Unseen Service-to-Service Pivot:** Identity traverses an edge `S_a -> S_b` never seen for its role/peer group.
  2. **Multi-Hop Privilege Chain:** Rapid `k`-hop traversal (`k >= 2` within time window `W`) crossing trust tiers (e.g., `edge-gateway -> dev-service -> secrets-vault`).
  3. **Impossible/Concurrent Node Hop:** Same identity uses valid credentials across disjoint service enclaves inconsistently.
* **Explainable Alert Schema:** Every alert includes `alert_id`, `identity`, `services[]`, `event_ids[]`, `path_or_rule`, `explanation`, `confidence_score`, and `order_uncertain`.

### FR-13: Clock Skew & Out-of-Order Event Handling
* **Supported Skew Range:** Explicitly documented and configurable bounded watermark window (default: **`±30 seconds`**, tested up to **`±60 seconds`**).
* **Mechanism:**
  * Events carry `event_timestamp` (source clock) and `ingest_timestamp` (detector clock).
  * Detector holds events in a min-heap / watermark buffer up to `max_skew_window` before finalizing sequence-dependent rules.
  * Events arriving older than `watermark - max_skew_window` are processed via late-event reconciliation and flagged `late_arrival: true`.
  * When two causally relevant events have timestamps separated by less than `2 * estimated_clock_skew` (cannot reliably determine which happened first), the detector flags **`order_uncertain: true`** and lists both possible orderings in the alert metadata.

---

## 4. Non-Functional Requirements & Scoring Alignment

| Evaluation Category (100 pts) | Target Design Benchmarks |
|---|---|
| **Security Correctness (25 pts)** | Standardized PQC (`ML-KEM-768`, `ML-DSA-65`), hybrid key exchange, strict AEAD AAD binding, zero custom crypto, zero hard-coded secrets. |
| **Live / Automated Assessment (25 pts)** | Active defense: invalid epochs, replays, tampered backups, log-injection attempts, and session-hijack attempts are actively blocked AND logged as security alerts (enables deduction recovery). |
| **Functionality & Reliability (20 pts)** | Automated scripts prove normal E2E transfer, rotation + revocation enforcement, `SIGKILL` crash recovery, chunk loss/reorder recovery, and verifiable metrics. |
| **Threat Model & Honesty (10 pts)** | Dedicated 1-page threat model documenting assets, adversaries, trust boundaries, assumptions (e.g., trusted host memory, `±30s` clock bound), and explicit limits. |
| **Performance & Overhead (10 pts)** | PQC handshake/encapsulation latency < 15 ms; E2E throughput overhead < 15%; revocation propagation < 500 ms across local nodes; binary size & memory footprint kept minimal. |
| **Usability & Documentation (10 pts)** | One-command clean-machine setup (`docker compose up` or `make verify`), crystal-clear `README.md`, clean React UI, structured Go modules. |

---

## 5. Deliverables Checklist
1. **Public GitHub Repository (`urGuard`):**
   * Root config & build files (`.env.example`, `.gitignore`, `.dockerignore`, `.editorconfig`, `Makefile`, `LICENSE`, `README.md`)
   * `.github/` (clean-machine CI workflow)
   * `backend/` (Go services, Protobuf contracts, PQC crypto, store, protocol, detector, CLI & tests)
   * `frontend/` (React + TypeScript + ConnectRPC operator console)
   * `deployments/` (Dockerfiles, reverse proxy config & multi-node Compose stack)
   * `scripts/` (clean-machine setup, codegen, chaos/crash recovery tests & benchmark/evaluation runner)
   * `docs/` (PRD, implementation plan, 1-page threat model & 2-page project brief PDF)
   * `README.md` (clean-machine prerequisites, exact build/run/verify commands, dependency list, grace-period & clock-skew documentation)
2. **2-Page Project Brief (PDF):**
   * Page 1: Problem, USP, Architecture diagram, Key metrics (F1, alert latency, false-alert rate, revocation time, PQC overhead)
   * Page 2: **1-Page Threat Model** + **Unlisted YouTube / Google Drive link to 5-Minute Demo Video**
