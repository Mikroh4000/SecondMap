use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn maps_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("app_data_dir failed: {e}"))?;
  let root = base.join("maps");
  fs::create_dir_all(&root).map_err(|e| format!("create_dir_all failed: {e}"))?;
  Ok(root)
}

fn sanitize_folder_name(name: &str) -> String {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return "Neuer Ordner".to_string();
  }
  let mut out = String::with_capacity(trimmed.len());
  for ch in trimmed.chars() {
    let invalid = matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control();
    if invalid {
      out.push('_');
    } else {
      out.push(ch);
    }
  }
  out.trim().to_string()
}

fn unique_dir_path(base: &Path, folder_name: &str) -> PathBuf {
  let mut candidate = base.join(folder_name);
  if !candidate.exists() {
    return candidate;
  }
  let mut i = 2;
  loop {
    candidate = base.join(format!("{folder_name} ({i})"));
    if !candidate.exists() {
      return candidate;
    }
    i += 1;
  }
}

#[tauri::command]
fn get_maps_root_dir(app: AppHandle) -> Result<String, String> {
  let root = maps_root_dir(&app)?;
  Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
fn create_folder_on_disk(app: AppHandle, name: String, parent_path: Option<String>) -> Result<String, String> {
  let root = maps_root_dir(&app)?;
  let parent = if let Some(p) = parent_path {
    PathBuf::from(p)
  } else {
    root.clone()
  };
  fs::create_dir_all(&parent).map_err(|e| format!("ensure parent failed: {e}"))?;

  let safe_name = sanitize_folder_name(&name);
  let target = unique_dir_path(&parent, &safe_name);
  fs::create_dir_all(&target).map_err(|e| format!("create folder failed: {e}"))?;
  Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn rename_folder_on_disk(path: String, new_name: String) -> Result<String, String> {
  let old = PathBuf::from(path);
  let parent = old
    .parent()
    .ok_or_else(|| "Invalid folder path".to_string())?
    .to_path_buf();
  let safe_name = sanitize_folder_name(&new_name);
  let new_path = unique_dir_path(&parent, &safe_name);
  fs::rename(&old, &new_path).map_err(|e| format!("rename folder failed: {e}"))?;
  Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_folder_on_disk(path: String) -> Result<(), String> {
  let p = PathBuf::from(path);
  if p.exists() {
    fs::remove_dir_all(&p).map_err(|e| format!("delete folder failed: {e}"))?;
  }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![
      get_maps_root_dir,
      create_folder_on_disk,
      rename_folder_on_disk,
      delete_folder_on_disk
    ])
    .setup(|app| {
      // Create the main window programmatically so we can disable Tauri's
      // built-in file-drop handler. Without this, WebView2 on Windows intercepts
      // ALL dragover events and shows a prohibition cursor, breaking HTML5
      // drag-and-drop between sidebar elements.
      #[cfg(not(mobile))]
      {
        tauri::WebviewWindowBuilder::new(
          app,
          "main",
          tauri::WebviewUrl::App("index.html".into()),
        )
        .title("SecondMap")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .disable_drag_drop_handler()
        .build()?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
