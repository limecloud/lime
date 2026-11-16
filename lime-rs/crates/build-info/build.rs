fn main() {
    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=LIME_BUILD_TARGET={target}");
    }
}
