use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use uuid::Uuid;

pub(crate) fn shared_aster_runtime_test_root() -> PathBuf {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();

    ROOT.get_or_init(|| {
        let root =
            std::env::temp_dir().join(format!("lime-aster-runtime-tests-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("创建共享 Aster runtime 测试目录失败");
        root
    })
    .clone()
}
