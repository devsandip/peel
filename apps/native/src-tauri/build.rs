fn main() {
    tauri_build::build();
    println!("cargo:rerun-if-changed=src/login_item.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/login_item.m")
            .flag("-fobjc-arc")
            .flag("-mmacosx-version-min=14.0")
            .warnings_into_errors(true)
            .compile("peel_login_item");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=ServiceManagement");
    }
}
