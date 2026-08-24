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
fn retries_the_requested_run_through_the_briar_cli() {
    let arguments = auto_hunt_retry_arguments(
        "515b7a2c-8918-5a8f-a292-f0b95090281c",
        "616b7a2c-8918-5a8f-a292-f0b95090281d",
        "GitHub authentication was restored.",
    );

    assert_eq!(
        arguments,
        vec![
            "run",
            "retry",
            "--run",
            "515b7a2c-8918-5a8f-a292-f0b95090281c",
            "--request-id",
            "616b7a2c-8918-5a8f-a292-f0b95090281d",
            "--reason",
            "GitHub authentication was restored.",
            "--actor",
            "briar-agent-host-tool",
        ],
    );
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
    );

    let detail_index = arguments
        .iter()
        .position(|argument| argument == "--status-detail")
        .expect("blocked event should include a reason");
    assert!(arguments[detail_index + 1].contains("작업 공간 생성 단계가 실패했습니다"));
    assert!(arguments[detail_index + 1].contains("원본 오류: worktree creation failed"));

    let result_index = arguments
        .iter()
        .position(|argument| argument == "--structured-result")
        .expect("blocked event should include a structured result");
    let result: serde_json::Value = serde_json::from_str(&arguments[result_index + 1])
        .expect("structured result should be valid JSON");
    assert_eq!(result["outcome"], "blocked");
    assert_eq!(result["humanActionRequired"], true);
    assert!(result["summary"]
        .as_str()
        .expect("summary should be text")
        .contains("작업을 시작할 수 없습니다"));
    assert!(result["nextAction"]
        .as_str()
        .expect("next action should be text")
        .contains("저장소 연결을 다시 확인"));
}

#[test]
fn parses_the_claimed_runs_durable_issue_snapshot() {
    let response = serde_json::from_value::<CliClaimResponse>(serde_json::json!({
        "work": {
            "runId": "515b7a2c-8918-5a8f-a292-f0b95090281c",
            "runNumber": 13,
            "sourceKey": "BRIAR-13",
            "title": "Render the attached layout",
            "description": "Match the mobile reference.",
            "priority": 1,
            "context": { "customer": "enterprise" },
            "workflow": { "version": 2 },
            "attachments": [{
                "id": "attachment-1",
                "filename": "layout.png",
                "contentType": "image/png",
                "byteSize": 2048,
                "url": "/projects/project-1/runs/run-1/attachments/attachment-1",
                "localPath": "/tmp/attachments/layout.png",
                "downloadError": null
            }],
            "messages": [{
                "id": "message-1",
                "parentMessageId": null,
                "body": "The compact breakpoint is required.",
                "author": {
                    "id": "user-1",
                    "name": "Jay",
                    "provider": null
                },
                "createdAt": "2026-07-30T00:00:00Z",
                "updatedAt": "2026-07-30T00:00:00Z"
            }]
        }
    }))
    .expect("claim response should parse");
    let work = response.work.expect("claim should contain work");

    assert_eq!(
        work.description.as_deref(),
        Some("Match the mobile reference.")
    );
    assert_eq!(
        work.attachments[0].local_path.as_deref(),
        Some("/tmp/attachments/layout.png")
    );
    assert_eq!(work.messages[0].body, "The compact breakpoint is required.");
}
