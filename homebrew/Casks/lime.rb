cask "lime" do
  version "0.37.0"

  on_arm do
    sha256 "REPLACE_WITH_ARM64_SHA256"
    url "https://github.com/aiclientproxy/lime/releases/download/v#{version}/Lime_#{version}_aarch64.dmg"
  end

  on_intel do
    sha256 "REPLACE_WITH_X64_SHA256"
    url "https://github.com/aiclientproxy/lime/releases/download/v#{version}/Lime_#{version}_x64.dmg"
  end

  name "Lime"
  desc "AI 代理服务桌面应用 - 多 Provider 凭证池管理"
  homepage "https://github.com/aiclientproxy/lime"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Lime.app"

  zap trash: [
    "~/Library/Application Support/com.limecloud.lime",
    "~/Library/Caches/com.limecloud.lime",
    "~/Library/Preferences/com.limecloud.lime.plist",
    "~/Library/Saved Application State/com.limecloud.lime.savedState",
  ]
end
