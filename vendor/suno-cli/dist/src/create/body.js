import { createHash, randomUUID } from "node:crypto";
const MODEL_ALIASES = {
    "v5.5": "chirp-fenix",
    "chirp-fenix": "chirp-fenix"
};
export function buildCreateBody(input) {
    if (!input.title)
        throw new Error("create requires --title.");
    if (!input.style)
        throw new Error("create requires --style.");
    const model = MODEL_ALIASES[input.model ?? "v5.5"] ?? input.model ?? "chirp-fenix";
    const transactionUuid = input.transactionUuid ?? randomUUID();
    const metadata = {
        create_mode: "custom",
        is_max_mode: false,
        is_mumble: false,
        disable_volume_normalization: false,
        web_client_pathname: "/create"
    };
    if (input.vocalGender)
        metadata.vocal_gender = input.vocalGender;
    if (input.coverClipId)
        metadata.is_remix = true;
    if (input.sessionToken)
        metadata.create_session_token = input.sessionToken;
    if (input.userTier)
        metadata.user_tier = input.userTier;
    const controlSliders = {};
    if (input.weirdness !== undefined)
        controlSliders.weirdness_constraint = input.weirdness;
    if (input.styleInfluence !== undefined)
        controlSliders.style_weight = input.styleInfluence;
    if (input.audioInfluence !== undefined)
        controlSliders.audio_weight = input.audioInfluence;
    if (Object.keys(controlSliders).length > 0)
        metadata.control_sliders = controlSliders;
    const body = {
        tags: input.style,
        negative_tags: input.exclude ?? "",
        prompt: input.instrumental ? "" : input.lyrics ?? "",
        title: input.title,
        make_instrumental: input.instrumental ?? false,
        mv: model,
        metadata,
        transaction_uuid: transactionUuid,
        token: input.token === undefined ? "__DRY_RUN_CAPTCHA_TOKEN__" : input.token,
        token_provider: input.tokenProvider === undefined ? "hcaptcha" : input.tokenProvider,
        override_fields: [],
        persona_id: input.personaId ?? null,
        cover_clip_id: input.coverClipId ?? null,
        continue_clip_id: null,
        continue_at: null,
        continued_aligned_prompt: null,
        artist_clip_id: null,
        artist_start_s: null,
        artist_end_s: null,
        user_uploaded_images_b64: null,
        generation_type: "TEXT"
    };
    if (input.coverClipId) {
        body.task = "cover";
        if (input.coverStartS !== undefined)
            body.cover_start_s = input.coverStartS;
        if (input.coverEndS !== undefined)
            body.cover_end_s = input.coverEndS;
    }
    else {
        body.cover_start_s = null;
        body.cover_end_s = null;
    }
    return body;
}
export function hashCreateBody(body) {
    const copy = { ...body, token: "[REDACTED]", transaction_uuid: "[IDEMPOTENT]" };
    return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}
