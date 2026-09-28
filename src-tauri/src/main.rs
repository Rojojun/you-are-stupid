use chrono::{TimeZone, Utc};
use serde::Serialize;
use std::{env, fs, io::{BufRead, BufReader}, path::{Path, PathBuf}};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceDiscovery {
    source: &'static str,
    state: &'static str,
    session_count: usize,
    detail: &'static str,
}

fn home_directory() -> Option<std::path::PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

fn count_matching_files(directory: &Path, extension: &str) -> usize {
    let Ok(entries) = fs::read_dir(directory) else {
        return 0;
    };

    entries
        .flatten()
        .map(|entry| entry.path())
        .map(|path| {
            if path.is_dir() {
                count_matching_files(&path, extension)
            } else if path.extension().is_some_and(|value| value == extension) {
                1
            } else {
                0
            }
        })
        .sum()
}

fn matching_files(directory: &Path, extension: &str, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            matching_files(&path, extension, files);
        } else if path.extension().is_some_and(|value| value == extension) {
            files.push(path);
        }
    }
}

fn files_named(directory: &Path, filename: &str, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            files_named(&path, filename, files);
        } else if path.file_name().is_some_and(|value| value == filename) {
            files.push(path);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedEvent {
    schema_version: u8,
    event_id: String,
    workspace_id: &'static str,
    conversation_id: String,
    source: &'static str,
    role: &'static str,
    occurred_at: String,
    text: String,
    model: Option<String>,
    token_usage: TokenUsage,
    provenance: &'static str,
}

#[derive(Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum TokenUsage {
    Unavailable,
    Observed { input: u64, output: u64, total: u64 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceImportResult {
    session_count: usize,
    event_count: usize,
    skipped_line_count: usize,
    events: Vec<ImportedEvent>,
}

fn json_text_content(value: &serde_json::Value) -> String {
    value
        .get("content")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            (item.get("type").and_then(serde_json::Value::as_str) == Some("input_text")
                || item.get("type").and_then(serde_json::Value::as_str) == Some("output_text"))
                .then(|| item.get("text").and_then(serde_json::Value::as_str))
                .flatten()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn import_codex_file(path: &Path, events: &mut Vec<ImportedEvent>, skipped_line_count: &mut usize) {
    let Ok(file) = fs::File::open(path) else {
        *skipped_line_count += 1;
        return;
    };
    let mut conversation_id = path.file_stem().and_then(|value| value.to_str()).unwrap_or("unknown").to_owned();
    let mut model: Option<String> = None;

    for (line_number, line) in BufReader::new(file).lines().enumerate() {
        let Ok(line) = line else {
            *skipped_line_count += 1;
            continue;
        };
        let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) else {
            *skipped_line_count += 1;
            continue;
        };
        let payload = record.get("payload").unwrap_or(&serde_json::Value::Null);

        if record.get("type").and_then(serde_json::Value::as_str) == Some("session_meta") {
            if let Some(id) = payload.get("id").and_then(serde_json::Value::as_str) {
                conversation_id = id.to_owned();
            }
            model = payload.get("model").and_then(serde_json::Value::as_str).map(str::to_owned);
            continue;
        }

        let is_message = record.get("type").and_then(serde_json::Value::as_str) == Some("response_item")
            && payload.get("type").and_then(serde_json::Value::as_str) == Some("message");
        if !is_message {
            continue;
        }
        let Some(role) = payload.get("role").and_then(serde_json::Value::as_str) else {
            *skipped_line_count += 1;
            continue;
        };
        let role = match role {
            "user" => "user",
            "assistant" => "assistant",
            _ => continue,
        };
        let text = json_text_content(payload);
        if text.trim().is_empty() {
            continue;
        }
        let Some(occurred_at) = record.get("timestamp").and_then(serde_json::Value::as_str) else {
            *skipped_line_count += 1;
            continue;
        };
        let ordinal = record.get("ordinal").and_then(serde_json::Value::as_u64).unwrap_or(line_number as u64);
        events.push(ImportedEvent {
            schema_version: 1,
            event_id: format!("codex:{conversation_id}:{ordinal}"),
            workspace_id: "local-auto-scan",
            conversation_id: conversation_id.clone(),
            source: "codex",
            role,
            occurred_at: occurred_at.to_owned(),
            text,
            model: model.clone(),
            token_usage: TokenUsage::Unavailable,
            provenance: "local_readonly",
        });
    }
}

#[tauri::command(rename_all = "camelCase")]
fn import_codex_conversations(known_event_ids: Vec<String>) -> SourceImportResult {
    let Some(home) = home_directory() else {
        return SourceImportResult { session_count: 0, event_count: 0, skipped_line_count: 0, events: vec![] };
    };
    let mut files = vec![];
    matching_files(&home.join(".codex/sessions"), "jsonl", &mut files);
    files.sort();

    let mut events = vec![];
    let mut skipped_line_count = 0;
    for path in &files {
        import_codex_file(path, &mut events, &mut skipped_line_count);
    }
    events = only_new_events(events, &known_event_ids);
    events.sort_by(|left, right| left.occurred_at.cmp(&right.occurred_at));
    SourceImportResult { session_count: files.len(), event_count: events.len(), skipped_line_count, events }
}

fn claude_text_content(message: &serde_json::Value) -> String {
    match message.get("content") {
        Some(serde_json::Value::String(text)) => text.to_owned(),
        Some(serde_json::Value::Array(blocks)) => blocks
            .iter()
            .filter(|block| block.get("type").and_then(serde_json::Value::as_str) == Some("text"))
            .filter_map(|block| block.get("text").and_then(serde_json::Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn claude_token_usage(message: &serde_json::Value, role: &str) -> TokenUsage {
    if role != "assistant" {
        return TokenUsage::Unavailable;
    }
    let Some(usage) = message.get("usage") else {
        return TokenUsage::Unavailable;
    };
    let Some(input) = usage.get("input_tokens").and_then(serde_json::Value::as_u64) else {
        return TokenUsage::Unavailable;
    };
    let Some(output) = usage.get("output_tokens").and_then(serde_json::Value::as_u64) else {
        return TokenUsage::Unavailable;
    };
    TokenUsage::Observed { input, output, total: input + output }
}

fn import_claude_file(path: &Path, events: &mut Vec<ImportedEvent>, skipped_line_count: &mut usize) {
    let Ok(file) = fs::File::open(path) else {
        *skipped_line_count += 1;
        return;
    };
    let fallback_conversation_id = path.file_stem().and_then(|value| value.to_str()).unwrap_or("unknown").to_owned();
    for (line_number, line) in BufReader::new(file).lines().enumerate() {
        let Ok(line) = line else {
            *skipped_line_count += 1;
            continue;
        };
        let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) else {
            *skipped_line_count += 1;
            continue;
        };
        let Some(role) = record.get("type").and_then(serde_json::Value::as_str).and_then(|value| match value {
            "user" => Some("user"),
            "assistant" => Some("assistant"),
            _ => None,
        }) else {
            continue;
        };
        if record.get("isMeta").and_then(serde_json::Value::as_bool) == Some(true) {
            continue;
        }
        let message = record.get("message").unwrap_or(&serde_json::Value::Null);
        let text = claude_text_content(message);
        if text.trim().is_empty() {
            continue;
        }
        let Some(occurred_at) = record.get("timestamp").and_then(serde_json::Value::as_str) else {
            *skipped_line_count += 1;
            continue;
        };
        let conversation_id = record.get("sessionId")
            .or_else(|| record.get("session_id"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&fallback_conversation_id)
            .to_owned();
        let identifier = record.get("uuid").and_then(serde_json::Value::as_str).map(str::to_owned)
            .unwrap_or_else(|| line_number.to_string());
        events.push(ImportedEvent {
            schema_version: 1,
            event_id: format!("claude_code:{identifier}"),
            workspace_id: "local-auto-scan",
            conversation_id,
            source: "claude_code",
            role,
            occurred_at: occurred_at.to_owned(),
            text,
            model: message.get("model").and_then(serde_json::Value::as_str).map(str::to_owned),
            token_usage: claude_token_usage(message, role),
            provenance: "local_readonly",
        });
    }
}

#[tauri::command(rename_all = "camelCase")]
fn import_claude_conversations(known_event_ids: Vec<String>) -> SourceImportResult {
    let Some(home) = home_directory() else {
        return SourceImportResult { session_count: 0, event_count: 0, skipped_line_count: 0, events: vec![] };
    };
    let mut files = vec![];
    matching_files(&home.join(".claude/projects"), "jsonl", &mut files);
    files.sort();
    let mut events = vec![];
    let mut skipped_line_count = 0;
    for path in &files {
        import_claude_file(path, &mut events, &mut skipped_line_count);
    }
    events = only_new_events(events, &known_event_ids);
    events.sort_by(|left, right| left.occurred_at.cmp(&right.occurred_at));
    SourceImportResult { session_count: files.len(), event_count: events.len(), skipped_line_count, events }
}

fn antigravity_transcript_conversation_id(path: &Path) -> Option<String> {
    path.parent()?.parent()?.parent()?.file_name()?.to_str().map(str::to_owned)
}

fn antigravity_transcript_event(
    record: &serde_json::Value,
    conversation_id: &str,
    line_number: usize,
) -> Option<ImportedEvent> {
    let status = record.get("status").and_then(serde_json::Value::as_str);
    if !matches!(status, Some("DONE") | Some("COMPLETED")) {
        return None;
    }
    let role = match record.get("source").and_then(serde_json::Value::as_str) {
        Some("USER_EXPLICIT") => "user",
        Some("MODEL") => "assistant",
        _ => return None,
    };
    let text = record.get("content").and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            let value = json_text_content(record);
            (!value.trim().is_empty()).then_some(value)
        })
        .filter(|value| !value.trim().is_empty())?;
    let occurred_at = record.get("created_at").and_then(serde_json::Value::as_str)?;
    Some(ImportedEvent {
        schema_version: 1,
        event_id: format!("antigravity:{conversation_id}:transcript:{line_number}"),
        workspace_id: "local-auto-scan",
        conversation_id: conversation_id.to_owned(),
        source: "antigravity",
        role,
        occurred_at: occurred_at.to_owned(),
        text,
        model: None,
        token_usage: TokenUsage::Unavailable,
        provenance: "local_readonly",
    })
}

#[tauri::command(rename_all = "camelCase")]
fn import_antigravity_conversations(known_event_ids: Vec<String>) -> SourceImportResult {
    let Some(home) = home_directory() else {
        return SourceImportResult { session_count: 0, event_count: 0, skipped_line_count: 0, events: vec![] };
    };
    let root = home.join(".gemini/antigravity-cli");
    let mut transcript_files = vec![];
    files_named(&root.join("brain"), "transcript_full.jsonl", &mut transcript_files);
    transcript_files.sort();
    let mut events = vec![];
    let mut skipped_line_count = 0;
    let mut transcript_conversation_ids = std::collections::HashSet::new();
    for path in &transcript_files {
        let Some(conversation_id) = antigravity_transcript_conversation_id(path) else {
            skipped_line_count += 1;
            continue;
        };
        transcript_conversation_ids.insert(conversation_id.clone());
        let Ok(file) = fs::File::open(path) else {
            skipped_line_count += 1;
            continue;
        };
        for (line_number, line) in BufReader::new(file).lines().enumerate() {
            let Ok(line) = line else {
                skipped_line_count += 1;
                continue;
            };
            let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) else {
                skipped_line_count += 1;
                continue;
            };
            if let Some(event) = antigravity_transcript_event(&record, &conversation_id, line_number) {
                events.push(event);
            }
        }
    }

    // A history-only entry has no transcript yet. Preserve its user question without duplicating full transcripts.
    if let Ok(file) = fs::File::open(root.join("history.jsonl")) {
        for (line_number, line) in BufReader::new(file).lines().enumerate() {
            let Ok(line) = line else { continue };
            let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            let has_transcript = record.get("conversationId")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|id| transcript_conversation_ids.contains(id));
            if !has_transcript {
                if let Some(event) = antigravity_question_event(&record, line_number) {
                    events.push(event);
                }
            }
        }
    }
    events = only_new_events(events, &known_event_ids);
    events.sort_by(|left, right| left.occurred_at.cmp(&right.occurred_at));
    SourceImportResult {
        session_count: transcript_conversation_ids.len(),
        event_count: events.len(),
        skipped_line_count,
        events,
    }
}

fn only_new_events(events: Vec<ImportedEvent>, known_event_ids: &[String]) -> Vec<ImportedEvent> {
    let known: std::collections::HashSet<&str> = known_event_ids.iter().map(String::as_str).collect();
    events.into_iter().filter(|event| !known.contains(event.event_id.as_str())).collect()
}

fn antigravity_question_event(record: &serde_json::Value, line_number: usize) -> Option<ImportedEvent> {
    if record.get("type").and_then(serde_json::Value::as_str) == Some("slash_command") {
        return None;
    }
    let text = record.get("display").and_then(serde_json::Value::as_str).filter(|value| !value.trim().is_empty())?;
    let timestamp = record.get("timestamp").and_then(serde_json::Value::as_i64)?;
    let occurred_at = Utc.timestamp_millis_opt(timestamp).single()?.to_rfc3339();
    let conversation_id = record.get("conversationId").and_then(serde_json::Value::as_str).unwrap_or("unknown");
    Some(ImportedEvent {
        schema_version: 1,
        event_id: format!("antigravity:{conversation_id}:{line_number}"),
        workspace_id: "local-auto-scan",
        conversation_id: conversation_id.to_owned(),
        source: "antigravity",
        role: "user",
        occurred_at,
        text: text.to_owned(),
        model: None,
        token_usage: TokenUsage::Unavailable,
        provenance: "local_readonly",
    })
}

fn discover_jsonl_source(source: &'static str, directory: &Path, detail: &'static str) -> SourceDiscovery {
    let session_count = count_matching_files(directory, "jsonl");
    SourceDiscovery {
        source,
        state: if session_count > 0 { "ready" } else { "not_found" },
        session_count,
        detail: if session_count > 0 { detail } else { "로컬 대화 기록을 찾지 못했습니다." },
    }
}

#[tauri::command]
fn scan_local_sources() -> Vec<SourceDiscovery> {
    let Some(home) = home_directory() else {
        return vec![
            SourceDiscovery { source: "codex", state: "unavailable", session_count: 0, detail: "사용자 홈 폴더를 확인할 수 없습니다." },
            SourceDiscovery { source: "claude_code", state: "unavailable", session_count: 0, detail: "사용자 홈 폴더를 확인할 수 없습니다." },
            SourceDiscovery { source: "antigravity", state: "unavailable", session_count: 0, detail: "사용자 홈 폴더를 확인할 수 없습니다." },
        ];
    };

    let antigravity = home.join(".gemini/antigravity-cli");
    let antigravity_count = count_matching_files(&antigravity.join("conversations"), "db");

    vec![
        discover_jsonl_source("codex", &home.join(".codex/sessions"), "Codex JSONL 세션을 읽기 전용으로 발견했습니다."),
        discover_jsonl_source("claude_code", &home.join(".claude/projects"), "Claude Code JSONL 세션을 읽기 전용으로 발견했습니다."),
        SourceDiscovery {
            source: "antigravity",
            state: if antigravity_count > 0 { "metadata_ready" } else { "not_found" },
            session_count: antigravity_count,
            detail: if antigravity_count > 0 {
                "Antigravity CLI 대화 DB를 발견했습니다. 다음 단계에서 스냅샷 import를 연결합니다."
            } else {
                "Antigravity CLI 대화 DB를 찾지 못했습니다."
            },
        },
    ]
}

#[tauri::command]
fn app_health() -> &'static str {
    "ok"
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let salt_path = app.path().app_local_data_dir()?.join("vault-salt");
            app.handle().plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_health,
            scan_local_sources,
            import_codex_conversations,
            import_claude_conversations,
            import_antigravity_conversations
        ])
        .run(tauri::generate_context!())
        .expect("failed to run YAS");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_only_user_and_assistant_text_messages_from_a_codex_rollout() {
        let directory = env::temp_dir().join(format!("yas-codex-test-{}", std::process::id()));
        fs::create_dir_all(&directory).expect("create fixture directory");
        let fixture = directory.join("rollout.jsonl");
        fs::write(
            &fixture,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"session-1\",\"model\":\"test-model\"}}\n",
                "{\"ordinal\":1,\"timestamp\":\"2026-09-21T00:00:00Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"first request\"}]}}\n",
                "{\"ordinal\":2,\"timestamp\":\"2026-09-21T00:01:00Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"first reply\"}]}}\n",
                "{\"ordinal\":3,\"timestamp\":\"2026-09-21T00:02:00Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"tool\",\"content\":[{\"type\":\"output_text\",\"text\":\"ignore\"}]}}\n"
            ),
        )
        .expect("write fixture");

        let mut events = vec![];
        let mut skipped = 0;
        import_codex_file(&fixture, &mut events, &mut skipped);

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].conversation_id, "session-1");
        assert_eq!(events[0].role, "user");
        assert_eq!(events[1].role, "assistant");
        assert_eq!(events[1].model.as_deref(), Some("test-model"));
        assert_eq!(skipped, 0);

        fs::remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn imports_claude_text_blocks_and_observed_assistant_tokens() {
        let directory = env::temp_dir().join(format!("yas-claude-test-{}", std::process::id()));
        fs::create_dir_all(&directory).expect("create fixture directory");
        let fixture = directory.join("session.jsonl");
        fs::write(
            &fixture,
            concat!(
                "{\"type\":\"user\",\"uuid\":\"user-1\",\"sessionId\":\"session-2\",\"timestamp\":\"2026-09-21T00:00:00Z\",\"message\":{\"content\":\"a request\"}}\n",
                "{\"type\":\"assistant\",\"uuid\":\"assistant-1\",\"sessionId\":\"session-2\",\"timestamp\":\"2026-09-21T00:01:00Z\",\"message\":{\"model\":\"claude-test\",\"content\":[{\"type\":\"text\",\"text\":\"an answer\"}],\"usage\":{\"input_tokens\":12,\"output_tokens\":8}}}\n",
                "{\"type\":\"assistant\",\"uuid\":\"tool-1\",\"sessionId\":\"session-2\",\"timestamp\":\"2026-09-21T00:02:00Z\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\"}]}}\n"
            ),
        )
        .expect("write fixture");

        let mut events = vec![];
        let mut skipped = 0;
        import_claude_file(&fixture, &mut events, &mut skipped);

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_id, "claude_code:user-1");
        assert_eq!(events[1].model.as_deref(), Some("claude-test"));
        assert!(matches!(events[1].token_usage, TokenUsage::Observed { input: 12, output: 8, total: 20 }));
        assert_eq!(skipped, 0);

        fs::remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn imports_antigravity_history_as_a_user_question() {
        let record = serde_json::json!({
            "conversationId": "conversation-3",
            "display": "show my previous work",
            "timestamp": 1789862400000i64,
            "workspace": "/workspace"
        });

        let event = antigravity_question_event(&record, 7).expect("history question event");

        assert_eq!(event.event_id, "antigravity:conversation-3:7");
        assert_eq!(event.role, "user");
        assert_eq!(event.text, "show my previous work");
        assert!(event.occurred_at.starts_with("2026-09-20T"));
    }

    #[test]
    fn imports_completed_antigravity_user_and_model_transcript_messages() {
        let user = serde_json::json!({
            "type": "USER_INPUT",
            "source": "USER_EXPLICIT",
            "status": "DONE",
            "created_at": "2026-09-21T00:00:00Z",
            "content": "inspect this project"
        });
        let response = serde_json::json!({
            "type": "GENERIC",
            "source": "MODEL",
            "status": "DONE",
            "created_at": "2026-09-21T00:01:00Z",
            "content": "I found the project files."
        });
        let partial = serde_json::json!({
            "type": "GENERIC",
            "source": "MODEL",
            "status": "RUNNING",
            "created_at": "2026-09-21T00:00:30Z",
            "content": "partial output"
        });

        let user_event = antigravity_transcript_event(&user, "conversation-4", 1).expect("user event");
        let response_event = antigravity_transcript_event(&response, "conversation-4", 2).expect("response event");

        assert_eq!(user_event.role, "user");
        assert_eq!(response_event.role, "assistant");
        assert_eq!(response_event.text, "I found the project files.");
        assert!(antigravity_transcript_event(&partial, "conversation-4", 3).is_none());
    }

    #[test]
    fn imports_antigravity_structured_model_content() {
        let response = serde_json::json!({
            "type": "GENERIC",
            "source": "MODEL",
            "status": "COMPLETED",
            "created_at": "2026-09-21T00:01:00Z",
            "content": [{"type": "output_text", "text": "첫 문단"}, {"type": "output_text", "text": "둘째 문단"}]
        });
        let event = antigravity_transcript_event(&response, "conversation-5", 4).expect("structured response event");
        assert_eq!(event.role, "assistant");
        assert_eq!(event.text, "첫 문단\n둘째 문단");
    }
}
