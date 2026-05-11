fn main() {
    if std::env::var("OPENMC_STUDIO_SKIP_TAURI_BUILD").is_ok() {
        return;
    }

    tauri_build::build()
}
