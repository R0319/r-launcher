package jp.r0319.rverify;

import com.mojang.logging.LogUtils;
import org.slf4j.Logger;

import jp.r0319.rverify.core.ManifestClient;
import jp.r0319.rverify.network.ClientPayloadHandler;
import jp.r0319.rverify.network.ModListRequestPayload;
import jp.r0319.rverify.network.ModListResponsePayload;
import jp.r0319.rverify.network.RVerifyConfigurationTask;
import jp.r0319.rverify.network.ServerPayloadHandler;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.network.event.RegisterConfigurationTasksEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

/**
 * R-Launcher Verify メイン。NeoForge 依存のグルー層。
 * ローダー/バージョン変更時は基本的にこのパッケージ（jp.r0319.rverify の core 以外）だけを
 * 直せばよい設計にしている（検証ロジック本体は core パッケージに隔離）。
 */
@Mod(RVerifyMod.MODID)
public class RVerifyMod {
    public static final String MODID = "rverify";
    public static final Logger LOGGER = LogUtils.getLogger();

    // manifest 取得結果を 60 秒キャッシュ（接続のたびに EC2 を叩かない）。
    public static final ManifestClient MANIFEST = new ManifestClient(60_000L);

    public RVerifyMod(IEventBus modEventBus, ModContainer modContainer) {
        // ペイロード登録・configuration タスク登録はどちらも MOD バス。
        // （RegisterConfigurationTasksEvent は IModBusEvent。ゲームバスに載せると起動時クラッシュ）
        modEventBus.addListener(this::registerPayloads);
        modEventBus.addListener(this::registerConfigTasks);
        // 検証設定はサーバー側で持つ（dedicated server の serverconfig/ に生成される）。
        modContainer.registerConfig(ModConfig.Type.SERVER, RVerifyConfig.SPEC);
    }

    private void registerPayloads(final RegisterPayloadHandlersEvent event) {
        final PayloadRegistrar registrar = event.registrar("1");
        // サーバー→クライアント: MOD一覧の要求
        registrar.configurationToClient(
                ModListRequestPayload.TYPE,
                ModListRequestPayload.STREAM_CODEC,
                ClientPayloadHandler::handleRequest);
        // クライアント→サーバー: MOD一覧＋ハッシュの応答
        registrar.configurationToServer(
                ModListResponsePayload.TYPE,
                ModListResponsePayload.STREAM_CODEC,
                ServerPayloadHandler::handleResponse);
    }

    private void registerConfigTasks(final RegisterConfigurationTasksEvent event) {
        event.register(new RVerifyConfigurationTask());
    }
}
