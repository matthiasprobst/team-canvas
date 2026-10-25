package dev.teamcanvas

/** Server budgets. Client batching targets deliberately leave headroom below these limits. */
object BoardLimits {
    const val CONNECTIONS = 200
    const val CONNECTIONS_PER_ACCOUNT = 20
    const val MESSAGE_BYTES = 2_000_000
    const val OUTGOING_MESSAGES = 64
    const val OUTGOING_BYTES = 8_000_000L
    const val PATCH_ELEMENTS = 100
    const val ELEMENTS = 4000
    const val ASSETS = 150
    const val SCENE_BYTES = 4_000_000
    const val ASSET_BYTES = 32_000_000
    const val COMMANDS_PER_DAY = 50_000
}
