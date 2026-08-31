use super::*;

#[test]
fn resumes_an_existing_auto_hunt_event_log_without_overwriting_records() {
    let directory = tempfile::tempdir().expect("event log directory should exist");
    let path = directory.path().join("session-1.jsonl");
    let (mut file, last_sequence) =
        open_auto_hunt_event_log(&path).expect("new event log should open");
    assert_eq!(last_sequence, 0);

    let first = agent::AppServerEventRecord::new(
        "session-1".to_string(),
        1,
        agent::AgentProviderEvent {
            provider: agent::AgentProviderKind::Codex,
            direction: agent::AgentEventDirection::Server,
            raw: serde_json::json!({"message": "first attempt"}),
            event: None,
        },
    );
    serde_json::to_writer(&mut file, &first).expect("first event should serialize");
    file.write_all(b"\n").expect("first event should finish");
    file.flush().expect("first event should persist");
    drop(file);

    let (mut file, last_sequence) =
        open_auto_hunt_event_log(&path).expect("existing event log should reopen");
    assert_eq!(last_sequence, 1);

    let second = agent::AppServerEventRecord::new(
        "session-1".to_string(),
        last_sequence + 1,
        agent::AgentProviderEvent {
            provider: agent::AgentProviderKind::Codex,
            direction: agent::AgentEventDirection::Server,
            raw: serde_json::json!({"message": "resumed attempt"}),
            event: None,
        },
    );
    serde_json::to_writer(&mut file, &second).expect("resumed event should serialize");
    file.write_all(b"\n").expect("resumed event should finish");
    file.flush().expect("resumed event should persist");
    drop(file);

    let contents = fs::read_to_string(path).expect("event log should be readable");
    let records = parse_auto_hunt_event_records(&contents).expect("event log should remain valid");
    assert_eq!(
        records
            .iter()
            .map(|record| record.sequence)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(records[0].message["message"], "first attempt");
    assert_eq!(records[1].message["message"], "resumed attempt");
}

#[test]
fn validates_auto_hunt_session_ids_before_building_log_paths() {
    assert!(validate_auto_hunt_session_id("019f8a9c-2c95-7591-a096-fcbf930cf122").is_ok());
    assert!(validate_auto_hunt_session_id("../session").is_err());
    assert!(validate_auto_hunt_session_id("session.jsonl").is_err());
    assert!(validate_auto_hunt_session_id("").is_err());
}

#[test]
fn targets_the_requested_run_when_claiming_auto_hunt_work() {
    let arguments = auto_hunt_claim_arguments("515b7a2c-8918-5a8f-a292-f0b95090281c");

    assert_eq!(
        arguments,
        vec![
            "queue",
            "claim",
            "--run",
            "515b7a2c-8918-5a8f-a292-f0b95090281c",
            "--workspace",
            "worktree",
            "--actor",
            "briar-auto-hunt-runtime",
            "--runtime-dispatch",
        ],
    );
}

#[test]
fn maintains_the_finished_workers_exact_worktree() {
    let arguments = auto_hunt_worktree_maintenance_arguments(
        Path::new("/tmp/briar/workspaces/project/issue-515b7a2c"),
        Some("515b7a2c-8918-5a8f-a292-f0b95090281c"),
        Some("2026-08-06T00:00:00Z"),
    );

    assert_eq!(
        arguments,
        vec![
            "worktree",
            "maintain",
            "--path",
            "/tmp/briar/workspaces/project/issue-515b7a2c",
            "--run",
            "515b7a2c-8918-5a8f-a292-f0b95090281c",
            "--completed-at",
            "2026-08-06T00:00:00Z",
        ],
    );
}

#[test]
fn records_an_actionable_handoff_for_runtime_blockers() {
    let arguments = auto_hunt_terminal_event_arguments(
        "515b7a2c-8918-5a8f-a292-f0b95090281c",
        "BRIAR-13",
        "blocked",
        "workspace-allocation",
        "worktree creation failed",
    )
    .expect("blocked event arguments should serialize");

    let detail_index = arguments
        .iter()
        .position(|argument| argument == "--status-detail")
        .expect("blocked event should include a reason");
    assert!(arguments[detail_index + 1].contains("작업 공간 생성 단계가 실패했습니다"));
    assert!(arguments[detail_index + 1].contains("원본 오류: worktree creation failed"));

    let result_index = arguments
        .iter()
        .position(|argument| argument == "--structured-result-proto-json")
        .expect("blocked event should include a structured result");
    let result: app_proto::StructuredRunResult = serde_json::from_str(&arguments[result_index + 1])
        .expect("structured result should be canonical generated ProtoJSON");
    assert_eq!(
        result.outcome.as_known(),
        Some(app_proto::structured_run_result::Outcome::Blocked)
    );
    assert_eq!(
        result.importance.as_known(),
        Some(app_proto::structured_run_result::Importance::Important)
    );
    assert_eq!(
        result.urgency.as_known(),
        Some(app_proto::structured_run_result::Urgency::Normal)
    );
    assert_eq!(
        result.impact.as_known(),
        Some(app_proto::structured_run_result::Impact::Issue)
    );
    assert!(result.human_action_required);
    assert!(result.summary.contains("작업을 시작할 수 없습니다"));
    assert!(result
        .next_action
        .expect("blocked result should include its next action")
        .contains("저장소 연결을 다시 확인"));
}

fn generated_claim(
    workspace: Option<local_proto::LocalWorkspace>,
    workspace_error: Option<&str>,
) -> local_proto::LocalClaimResult {
    let run = local_proto::LocalClaimedRun {
        payload: worker_proto::ClaimedIssuePayload {
            run_id: "515b7a2c-8918-5a8f-a292-f0b95090281c".to_string(),
            run_number: 13,
            source_key: "BRIAR-13".to_string(),
            title: "Render the attached layout".to_string(),
            workflow: types_proto::AutoHuntWorkflow {
                version: 2,
                ..Default::default()
            }
            .into(),
            ..Default::default()
        }
        .into(),
        workspace: workspace.into(),
        workspace_error: workspace_error.map(str::to_string),
        ..Default::default()
    };
    local_proto::LocalClaimResult {
        outcome: Some(local_proto::local_claim_result::Outcome::Claimed(Box::new(
            run,
        ))),
        ..Default::default()
    }
}

#[test]
fn maps_the_generated_no_work_outcome() {
    let result = claim_outcome(local_proto::LocalClaimResult {
        outcome: Some(local_proto::local_claim_result::Outcome::NoWork(
            Box::default(),
        )),
        ..Default::default()
    })
    .expect("generated no-work result should map");

    assert!(matches!(result, AutoHuntClaimOutcome::NoWork));
}

#[test]
fn maps_the_generated_worktree_to_the_runtime_domain() {
    let result = claim_outcome(generated_claim(
        Some(local_proto::LocalWorkspace {
            kind: local_proto::local_workspace::Kind::Worktree.into(),
            path: "/tmp/briar/worktrees/BRIAR-13".to_string(),
            ..Default::default()
        }),
        None,
    ))
    .expect("generated claim should map");

    let AutoHuntClaimOutcome::Claimed(claimed) = result else {
        panic!("claim should contain work");
    };
    assert_eq!(claimed.issue.source_key, "BRIAR-13");
    assert_eq!(
        claimed.workspace_path.as_deref(),
        Some("/tmp/briar/worktrees/BRIAR-13")
    );
}

#[test]
fn preserves_workspace_allocation_failure_as_claimed_work() {
    let result = claim_outcome(generated_claim(None, Some("worktree creation failed")))
        .expect("workspace failure should remain reportable");

    let AutoHuntClaimOutcome::Claimed(claimed) = result else {
        panic!("claim should remain claimed");
    };
    assert!(claimed.workspace_path.is_none());
    assert_eq!(
        claimed.workspace_error.as_deref(),
        Some("worktree creation failed")
    );
}

#[test]
fn maps_generated_run_evidence_and_rejects_a_mismatched_run() {
    let response: app_proto::ListRunEvidenceResponse = serde_json::from_value(serde_json::json!({
        "runId": "515b7a2c-8918-5a8f-a292-f0b95090281c",
        "evidence": [{
            "key": "local-tests",
            "attempt": 2,
            "revision": 3,
            "stage": "local_qa",
            "type": "test",
            "status": "STATUS_PASSED",
            "detail": "Rust checks passed",
            "actor": "briar-auto-hunt-runtime",
            "observedAt": "2026-08-31T01:02:03Z",
            "recordedAt": "2026-08-31T01:02:04Z",
            "canonical": true,
            "requiredRevision": 3
        }]
    }))
    .expect("generated evidence ProtoJSON should decode");

    let mapped = run_evidence_result(response.clone(), "515b7a2c-8918-5a8f-a292-f0b95090281c")
        .expect("matching evidence should map");
    assert_eq!(mapped.len(), 1);
    assert_eq!(mapped[0]["key"], "local-tests");
    assert_eq!(mapped[0]["status"], "passed");
    assert_eq!(mapped[0]["requiredRevision"], 3);
    assert_eq!(mapped[0]["canonical"], true);

    assert!(run_evidence_result(response, "different-run").is_err());
}
