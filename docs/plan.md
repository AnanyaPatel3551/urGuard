# Implementation Plan: urGuard

**Repository:** `urGuard`  
**Stack:** Go 1.24+ · ConnectRPC / gRPC · `cloudflare/circl` + `crypto/mlkem` · `bbolt` / `modernc.org/sqlite` · React + TypeScript + Vite  
**Team Structure:** 3 Engineers working in parallel across clearly defined module boundaries.

---

## 1. Repository Layout

```text
urGuard/
├── .env.example                       # Documented env vars (ports, grace period, clock skew, node URLs; no secrets)
├── .gitignore                         # Ignores .env, *.db, *.bbolt, bin/, dist/, node_modules/, *.key, *.pem
├── .dockerignore                      # Excludes build artifacts, local DBs, node_modules from Docker context
├── .editorconfig                      # Consistent formatting across Go, TS, Proto, YAML, and shell scripts
├── Makefile                           # Unified targets: proto, build, test, verify, bench, up, down, clean
├── LICENSE                            # Open-source license (e.g., Apache-2.0 / MIT)
├── README.md                          # Clean-machine setup, dependency inventory, architecture & eval commands
├── .github/
│   └── workflows/
│       └── ci.yml                     # Clean-machine CI: go test -race, frontend build, secret/AI-dep check
├── backend/
│   ├── go.mod
│   ├── go.sum
│   ├── buf.yaml                       # Protobuf lint & breaking-change config
│   ├── buf.gen.yaml                   # Reproducible Go + ConnectRPC + TypeScript codegen config
│   ├── proto/
│   │   └── urguard/v1/
│   │       ├── crypto_control.proto   # Key rotation, revocation, backup, enrollment
│   │       ├── messaging.proto        # E2E messages, chunked transfer, session resumption
│   │       └── telemetry.proto        # Audit log verification, ingestion, alerts, metrics
│   ├── gen/                           # Generated ConnectRPC + Protobuf Go stubs
│   ├── pkg/
│   │   ├── pqc/                       # ML-KEM-768 + X25519 hybrid, ML-DSA-65, HKDF, AEAD, zeroization
│   │   ├── store/                     # bbolt / pure-Go SQLite WAL persistence + signed backup envelope
│   │   ├── auditlog/                  # Canonical serialization, SHA-256 hash chain, ML-DSA checkpoints
│   │   └── protocol/                  # Replay window, recipient AAD binding, chunk reassembly, resumption
│   ├── internal/
│   │   ├── config/                    # Typed env/flag loader with validation (no hard-coded secrets)
│   │   ├── controlplane/              # Key authority, 2-phase rotation state machine, CRL streamer
│   │   ├── node/                      # Storage/relay node server, epoch enforcement, active transfer guard
│   │   ├── detector/                  # Watermark clock-skew buffer, rule/stat engine, access graph, eval
│   │   └── toolkit/                   # Adapter for ScalerOpenSourceLabs/Track-4-Toolkit mock services & logs
│   ├── cmd/
│   │   ├── controlplane/main.go       # Control plane + ConnectRPC API entrypoint
│   │   ├── node/main.go               # Relay/storage node entrypoint (run multiple instances)
│   │   └── urguard-cli/main.go        # Verification, toolkit adapter, chaos & metrics CLI
│   ├── testdata/                      # Synthetic logs, labeled attack traces, tamper/corrupt-backup fixtures
│   └── tests/                         # Integration, crash-recovery, security & benchmark suites
├── frontend/
│   ├── .env.example                   # Frontend API base URL (VITE_CONTROLPLANE_URL)
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── gen/                       # Generated ConnectRPC TypeScript clients
│       ├── api/                       # ConnectRPC transport & shared query/stream hooks
│       ├── types/                     # UI view models & alert/metric formatting helpers
│       ├── components/
│       │   ├── MessagingPanel.tsx     # E2E encrypted messaging & chunked file transfer demo
│       │   ├── KeyGovernancePanel.tsx # Rotation, grace-period status, revocation, re-enrollment, backup
│       │   ├── AuditLogPanel.tsx      # Hash-chain explorer & one-click integrity verifier
│       │   └── DetectionPanel.tsx     # Lateral movement graph, alerts, clock-skew flags, F1 metrics
│       ├── App.tsx
│       └── main.tsx
├── deployments/
│   ├── Dockerfile.backend             # Multi-stage static Go build (controlplane, node, cli)
│   ├── Dockerfile.frontend            # Multi-stage Node build + lightweight static server
│   ├── nginx.conf                     # Reverse proxy routing UI + ConnectRPC endpoints cleanly
│   └── docker-compose.yml             # 1 Control Plane + 3 Relay Nodes + Frontend UI
├── scripts/
│   ├── setup.sh / setup.ps1           # Clean-machine dependency, .env bootstrap & codegen check
│   ├── gen_proto.sh / gen_proto.ps1   # Regenerates Go & TS stubs via buf
│   ├── verify_all.sh / verify_all.ps1 # End-to-end automated Track 4 checklist runner
│   ├── chaos_crash_test.sh / .ps1     # SIGKILL mid-rotation & backup corruption verification
│   └── eval_detector.sh / .ps1        # Runs Track-4-Toolkit labeled log benchmark & prints metrics
└── docs/
    ├── prd.md
    ├── plan.md
    ├── threat-model.md                # Standalone 1-page threat model source
    └── project-brief.md               # Source for 2-page PDF export (USP, architecture, threat model, video link)
```

---

## 2. Team Ownership & Parallel Workstreams

### Engineer A — Core Cryptography, Control Plane, Storage & Node Enforcement
Owns the foundational security primitives, distributed key lifecycle, persistence, and node protocol enforcement:
1. **Protobuf Contracts & Config (`backend/proto/urguard/v1/*.proto`, `buf.yaml`, `buf.gen.yaml`, `internal/config`):** Lock API schemas and typed environment loading (`.env.example`) first so all 3 tracks integrate cleanly without blocking.
2. **PQC & Hybrid Envelope Package (`pkg/pqc`):**
   * Hybrid KEM (`X25519` + `ML-KEM-768` via `crypto/mlkem` / `cloudflare/circl`), `HKDF-SHA256`, `AES-256-GCM`, and `ML-DSA-65` signatures.
   * Ephemeral key generation & explicit memory zeroization helpers (`Forward Secrecy`).
   * Hybrid PQC-mTLS (`X25519MLKEM768`) config for node-to-control-plane gRPC.
3. **Crash-Safe Store & Backup Integrity (`pkg/store`):**
   * `bbolt` (or pure-Go `modernc.org/sqlite` WAL) persistence for `KeyEpoch`, two-phase rotation state (`IDLE -> PREPARING -> COMMITTED -> RETIRED`), monotonic `RevocationList`, and `DeviceRegistry`.
   * Encrypted + `ML-DSA-65` signed backup export/restore with SHA-256 manifest verification and tamper rejection.
4. **Tamper-Evident Audit Log (`pkg/auditlog`):**
   * Canonical structured encoding (injection-proof against crafted user strings/newlines), SHA-256 hash chain, periodic `ML-DSA-65` signed checkpoints, and `VerifyChain()` diagnostic API.
5. **Control Plane & Multi-Node Relay (`internal/controlplane`, `internal/node`, `pkg/protocol`):**
   * Rotation coordinator with documented 30s grace period and strict post-cutoff epoch rejection (`ERR_KEY_EPOCH_EXPIRED`).
   * gRPC Server-Streaming CRL pusher + 1s heartbeat reconciliation, measuring `revocation_propagation_ms` across all nodes.
   * Device-loss re-enrollment + DEK re-encapsulation so other authorized users retain access.
   * E2E protocol enforcement: AAD recipient binding, sliding replay cache, chunked loss/reordering reassembly, and peer-bound `ResumptionTicket` challenge-response.
6. **Chaos & Verification Harness (`cmd/urguard-cli`, `backend/tests/`):**
   * Automated tests for `SIGKILL` crash recovery, corrupted backup rejection, log-injection defense, replay/recipient-tamper rejection, session hijack rejection, and latency/overhead benchmarks.

### Engineer B — Explainable Detection Engine, Clock-Skew Pipeline & Toolkit Integration
Owns log ingestion, Track-4-Toolkit integration, deterministic/statistical detection, graph analysis, and evaluation metrics:
1. **Toolkit Schema & Log Adapter (`internal/detector/ingest.go`):**
   * Inspect `ScalerOpenSourceLabs/Track-4-Toolkit` mock service formats, synthetic access logs, and test identities.
   * Build parsers/adapters ingesting both Toolkit synthetic logs and live urGuard audit events into a unified `NormalizedEvent` struct.
2. **Clock-Skew & Out-of-Order Watermark Engine (`internal/detector/watermark.go`):**
   * Implement bounded out-of-orderness min-heap buffer (configurable `±30s` default, tested to `±60s`).
   * Emit `late_arrival: true` for events past watermark and `order_uncertain: true` when causal ordering falls inside `2 * max_clock_skew`.
3. **Routine vs. Suspicious Activity Classifier (`internal/detector/rules.go`):**
   * Context-aware deterministic rules + statistical baselines (EWMA access rate, rare-hour/rare-role scoring) separating `BENIGN_ADMIN` (valid maintenance ticket / expected admin flow) from suspicious privilege escalation or anomalous access.
   * Strictly **no AI/ML**—every classification emits human-readable rule IDs and threshold evidence.
4. **Graph-Based Lateral Movement Detector (`internal/detector/graph.go`):**
   * Maintain directed `Identity -> SourceService -> TargetService` transition graph.
   * Detect unseen cross-service pivots, rapid multi-hop trust-tier escalations, and concurrent disjoint-node credential usage.
   * Populate alert fields: `identity`, `services[]`, `event_ids[]`, `path_or_rule`, `order_uncertain`.
5. **Metrics & Benchmark Runner (`internal/detector/eval.go`):**
   * Evaluate against labeled synthetic logs and output **F1**, **Precision**, **Recall**, **Median Time to Alert (ms)**, and **False Alerts per 1,000 Benign Events**.
   * Expose live detection streams and metrics over ConnectRPC (`telemetry.proto`).

### Engineer C — React + TypeScript Operator Console, Deployments & Submission Deliverables
Owns the frontend operator experience, container orchestration, documentation, threat model, and demo packaging:
1. **Frontend Foundation (`frontend/`):**
   * Scaffold Vite + React + TypeScript + `@connectrpc/connect-web` + Tailwind/clean CSS system.
   * Generate TypeScript types/clients from `proto/urguard/v1/*.proto`.
2. **Operator Console Views:**
   * **E2E Messaging & File Transfer Panel:** Send encrypted messages/files across nodes, simulate packet loss/reordering, attempt replay/recipient tampering, and inspect rejection diagnostics.
   * **Key & Node Governance Panel:** Trigger key rotation (live grace-period countdown), revoke a compromised device across 3 nodes (showing per-node propagation latency), re-enroll a device while preserving collaborator access, export/tamper/verify backups.
   * **Audit Log & Integrity Panel:** Live canonical log stream, one-click `Verify Chain` badge, and interactive log-injection test demonstrating isolation of user-supplied text.
   * **Security Detection & Graph Panel:** Interactive SVG/Canvas service-to-service lateral movement graph highlighting flagged hops, alert drawer with `order_uncertain` badges, and live F1 / false-alert / median-latency KPI cards.
3. **Clean-Machine Packaging (`deployments/`, `scripts/`, `.github/workflows/ci.yml`, `Makefile`, `README.md`):**
   * Root `.env.example`, `.gitignore`, `.dockerignore`, `.editorconfig`, `Makefile`, and `frontend/.env.example`.
   * Multi-stage Dockerfiles + `nginx.conf` + `docker-compose.yml` running 1 Control Plane + 3 Nodes + React UI.
   * Clean-machine CI workflow (`.github/workflows/ci.yml`) and `README.md` with exact prerequisites, build steps, dependency list, and one-command verification instructions.
4. **Deliverables (`docs/`):**
   * **1-Page Threat Model** (assets, adversaries, trust boundaries, assumptions, explicit limits).
   * **2-Page Project Brief (PDF)** combining USP, architecture diagram, key benchmark metrics, threat model, and embedded **5-minute demo video link**.

---

## 3. Phased Execution Timeline (Hackathon Sprint)

### Phase 0: Contract Lock & Toolkit Alignment (Hours 0–3)
* **All:** Review `Track-4-Toolkit` synthetic log schemas, mock service endpoints, and test identities.
* **Engineer A:** Initialize `backend/go.mod`, define `proto/urguard/v1/*.proto`, configure `buf` / `protoc` codegen for Go + TS.
* **Engineer B:** Map `Track-4-Toolkit` log fields and labeled attack scenarios into detector fixtures.
* **Engineer C:** Scaffold `frontend/` with Vite + React + TS + ConnectRPC client setup.
* **Milestone Gate:** `proto` compiles cleanly to both `backend/gen` and `frontend/src/gen`.

### Phase 1: Core Security Engine & Detection MVP (Hours 3–12)
* **Engineer A:**
  * Implement `pkg/pqc` (hybrid KEM, `ML-DSA-65`, AEAD, zeroization) with unit tests.
  * Implement `pkg/store` (two-phase rotation WAL, monotonic revocation bucket, encrypted signed backup) + `pkg/auditlog` (canonical hash chain + checkpoints).
  * Build Control Plane + Node streaming revocation and rotation grace/cutoff enforcement.
* **Engineer B:**
  * Implement `watermark.go` (skew window + `order_uncertain` flagging).
  * Implement `rules.go` (context-aware routine vs. suspicious rules) + `graph.go` (lateral movement path detector).
  * Build initial evaluation runner outputting F1, median time to alert, and false alerts / 1k benign events.
* **Engineer C:**
  * Build App shell, navigation, and live ConnectRPC hooks.
  * Build `KeyGovernancePanel` and `AuditLogPanel` wired to live Control Plane endpoints (or initial mock/stub responses until Phase 2 merge).
  * Draft `docs/threat-model.md` outline and `deployments/docker-compose.yml`.
* **Milestone Gate:** Backend passes unit tests for PQC, rotation cutoff, backup tamper detection, log chain verification, and detector F1 baseline.

### Phase 2: Protocol Hardening, Chaos Testing & UI Integration (Hours 12–22)
* **Engineer A:**
  * Implement `pkg/protocol` (replay cache, recipient AAD binding, chunked loss/reorder recovery, peer-bound `ResumptionTicket`).
  * Multi-node integration tests: 3 nodes enforcing revocation < 500 ms, device-loss re-enrollment preserving collaborator access, and `SIGKILL` crash recovery during rotation.
  * Performance benchmark suite (PQC handshake latency, encryption throughput overhead).
* **Engineer B:**
  * Tune detection thresholds and graph rules against `Track-4-Toolkit` labeled logs to maximize F1 and minimize false alerts per 1,000 benign events.
  * Wire live audit stream + toolkit replay feeder into Control Plane `telemetry.proto` service.
  * Add unit/integration tests for clock-skew reordering (`±30s` / `±60s`) and lateral-movement alert explanations.
* **Engineer C:**
  * Complete `MessagingPanel` (loss/reorder/replay/tamper interactive demos) and `DetectionPanel` (lateral movement graph + alert details + KPI cards).
  * Wire full Docker Compose stack (`controlplane` + `node-1/2/3` + `frontend`) and verify CORS/ConnectRPC routing.
* **Milestone Gate:** Full stack runs via `docker compose up`; all 12 Track 4 objectives pass end-to-end.

### Phase 3: Clean-Machine Verification, Brief & Demo Recording (Hours 22–30)
* **Engineer A:** Finalize `scripts/verify_all` automated test suite (runs all 12 checklist proofs + outputs JSON/table summary), audit repo for zero hard-coded secrets or custom crypto.
* **Engineer B:** Finalize labeled log evaluation report, verify clock-skew edge cases, and confirm zero AI/ML dependencies in `go.mod` / `package.json`.
* **Engineer C:** Test clean-machine setup from fresh clone, polish `README.md`, finalize **2-Page Project Brief PDF** (with 1-page Threat Model), record **5-minute demo video**, upload & embed link in PDF.
* **Milestone Gate:** Fresh clone builds and passes `verify_all` on a clean environment with zero manual intervention.

---

## 4. Verification Matrix (Mapping Tests to Track 4 Checklist)

| # | Objective | Automated Verification Test | Pass Criteria |
|---|---|---|---|
| 1 | **Key Rotation** | Start active chunked transfer → trigger rotation → send request with `epoch-1` during 30s grace vs. after cutoff | In-flight transfer finishes; post-cutoff `epoch-1` requests rejected on all 3 nodes (`ERR_KEY_EPOCH_EXPIRED`) |
| 2 | **Revocation Across Nodes** | Revoke `device_old` on Control Plane → immediately probe all 3 nodes → re-enroll `device_new` | All nodes reject `device_old`; propagation time logged; `device_new` & collaborators decrypt shared data |
| 3 | **Crash Recovery** | Start rotation → `SIGKILL` control plane mid-`PREPARING` → restart → inspect state & revoked keys | Consistent key version recovered; previously revoked keys stay revoked; committed data readable |
| 4 | **Backup Integrity** | Export backup → flip 1 byte in ciphertext & 1 byte in manifest → attempt restore | Restore aborts (`ERR_BACKUP_CORRUPTED`), live keys unchanged, integrity failure logged |
| 5 | **Log Integrity** | Submit message/filename containing `\n{"actor":"admin","action":"GRANT_ROOT"}` → verify log chain; then tamper 1 historical row in DB | Injection stays trapped in escaped metadata; `VerifyChain()` passes on valid log and pinpoints tampered `seq` |
| 6 | **Routine vs. Suspicious** | Run `eval` against labeled synthetic logs (routine admin + privilege attacks) | Outputs `F1`, `median_time_to_alert_ms`, `false_alerts_per_1k_benign` |
| 7 | **Lateral Movement** | Replay valid-credential multi-service pivot (`gateway -> dev -> vault`) | Alert includes `identity`, `services[]`, `event_ids[]`, `path_or_rule` |
| 8 | **Clock Differences** | Inject out-of-order events with `-25s` and `+25s` skew and near-simultaneous events (`Δ < skew`) | Proper causal ordering within `±30s`; ambiguous pairs flagged `order_uncertain: true` |
| 9 | **Replay & Recipient Binding** | Resend captured packet; tamper `recipient_id` header in transit | Both rejected (`ERR_REPLAY_DETECTED`, `ERR_RECIPIENT_MISMATCH`) and logged |
| 10 | **Forward Secrecy** | Complete session `S1` → extract/compromise `IK_sig` & current `EK_epoch` → attempt decrypt of `S1` capture | Decryption impossible without ephemeral `SK_ephem` (zeroized post-session) |
| 11 | **Delivery Under Loss/Reorder** | Deliver chunks `[2, 0, 3, 1]` (reordered) and `[0, 2]` (missing chunk `1`) | Reordered transfer succeeds intact; incomplete transfer discarded + `DELIVERY_FAILED` reported |
| 12 | **Session Resumption** | Issue `ResumptionTicket` to Identity A → replay `session_id` + ticket as Identity B | Rejected (`ERR_SESSION_IDENTITY_MISMATCH`) + `SESSION_HIJACK_ATTEMPT` alert raised |

---

## 5. Key Design Decisions & Explicit Boundaries
* **Why ConnectRPC over raw gRPC:** Single Go binary serves both native gRPC (inter-node & CLI) and browser-compatible Connect/gRPC-Web (React UI) without running Envoy, drastically simplifying clean-machine builds.
* **Why `bbolt` / `modernc.org/sqlite`:** Pure-Go embedded persistence eliminates CGO compiler issues during automated Stage 1 sandbox builds while giving ACID/WAL crash safety.
* **Grace Period & Clock Skew Defaults:** Both are parameterized via environment variables / flags (`URGUARD_ROTATION_GRACE_SEC=30`, `URGUARD_MAX_CLOCK_SKEW_SEC=30`) and surfaced directly in the UI and metrics output for transparent evaluation.
