// swift-tools-version:5.7
import PackageDescription

let package = Package(
  name: "tauri-plugin-essvb-tts",
  platforms: [
    .iOS(.v15)
  ],
  products: [
    .library(
      name: "tauri-plugin-essvb-tts",
      type: .static,
      targets: ["tauri-plugin-essvb-tts"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-essvb-tts",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources"
    )
  ]
)
