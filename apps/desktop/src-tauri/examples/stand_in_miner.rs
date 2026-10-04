//! Stand-in miner for the end-to-end test (built by `cargo test`): writes its arguments to
//! args.txt next to itself, then idles until the app stops it.
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let exe = std::env::current_exe().expect("own path");
    std::fs::write(exe.with_file_name("args.txt"), args.join(" ")).expect("write args.txt");
    std::thread::sleep(std::time::Duration::from_secs(3600));
}
