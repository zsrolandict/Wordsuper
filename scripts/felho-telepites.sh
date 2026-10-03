#!/usr/bin/env bash
# ICT LegalSuite szerver telepítése a Google Cloud Runra (EU, europe-west1). A Google Cloud Shellben futtasd, a
# repó mappájában (lépésenként: docs/FELHO-TELEPITES.md):
#
#   PROJECT=sajat-projekt-azonosito ./scripts/felho-telepites.sh
#
# Nem kötelező beállítások (a parancs elé írva, pl. AUTH_MODE=both PROJECT=… ./scripts/felho-telepites.sh):
#   REGION            a szerver helye (alap: europe-west1, Belgium)
#   SERVICE           a szolgáltatás neve (alap: ict-legalsuite)
#   AI_PROVIDER       vertex (alap: Vertex AI az EU-ban, kulcs nélkül) vagy gemini (a gemini-api-key titokkal)
#   VERTEX_LOCATION   a Vertex AI régiója (alap: a REGION)
#   AUTH_MODE         key (alap), both vagy microsoft; a két utóbbihoz MS_CLIENT_ID és MS_TENANT_ID is kell
#   MS_CLIENT_ID, MS_TENANT_ID, MS_ALLOWED_DOMAINS   Microsoft-belépés (docs/MICROSOFT-BELEPES.md)
#   MIN_INSTANCES     1 = mindig van futó példány, nincs hidegindítás (pár euró havonta); alap: 0
#
# Újrafuttatható: ami már megvan (szolgáltatásfiók, titkok), azt nem hozza létre újra, csak a kódot frissíti.
set -euo pipefail

PROJECT="${PROJECT:?Add meg a projekt azonosítóját: PROJECT=sajat-projekt ./scripts/felho-telepites.sh}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-ict-legalsuite}"
AI_PROVIDER="${AI_PROVIDER:-vertex}"
VERTEX_LOCATION="${VERTEX_LOCATION:-$REGION}"
AUTH_MODE="${AUTH_MODE:-key}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
RUNNER="${SERVICE}-runner"
SA="${RUNNER}@${PROJECT}.iam.gserviceaccount.com"

cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$1"; }

step "Projekt és szolgáltatások ($PROJECT)"
gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com aiplatform.googleapis.com

step "Szolgáltatásfiók: ezzel fut a szerver, csak az AI-hoz és a saját titkaihoz fér hozzá"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$RUNNER" --display-name="ICT LegalSuite szerver"
if [ "$AI_PROVIDER" = "vertex" ]; then
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
    --role=roles/aiplatform.user --condition=None >/dev/null
fi

# A titok csak az EU-ban tárolódik, és csak a szerver olvashatja
secret_exists() { gcloud secrets describe "$1" >/dev/null 2>&1; }
grant_secret() {
  gcloud secrets add-iam-policy-binding "$1" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor >/dev/null
}

step "Titkok"
SECRETS="APP_ACCESS_KEY=app-access-key:latest"
if ! secret_exists app-access-key; then
  openssl rand -hex 24 | gcloud secrets create app-access-key --data-file=- \
    --replication-policy=user-managed --locations="$REGION"
  echo "Új hozzáférési kulcs készült. Megnézni: gcloud secrets versions access latest --secret=app-access-key"
fi
grant_secret app-access-key
# Kollégánkénti kulcsok („Név:kulcs, Név2:kulcs2”), ha valaki ilyet tett el
if secret_exists app-access-keys; then
  grant_secret app-access-keys
  SECRETS="$SECRETS,APP_ACCESS_KEYS=app-access-keys:latest"
fi
if [ "$AI_PROVIDER" = "gemini" ]; then
  secret_exists gemini-api-key || {
    echo "AI_PROVIDER=gemini: előbb tedd el a Gemini-kulcsot titokként (a kulcs nem kerül a parancssor előzményeibe):"
    echo "  read -rs K && printf %s \"\$K\" | gcloud secrets create gemini-api-key --data-file=- --replication-policy=user-managed --locations=$REGION"
    exit 1
  }
  grant_secret gemini-api-key
  SECRETS="$SECRETS,GEMINI_API_KEY=gemini-api-key:latest"
fi
# Az irodai stílusok (a Formázás fül „Exportálás (.json)” fájlja), ha van ilyen titok: fájlként kerül a szerverre
STYLES_ENV=""
if secret_exists office-styles; then
  grant_secret office-styles
  SECRETS="$SECRETS,/secrets/office-styles.json=office-styles:latest"
  STYLES_ENV="@OFFICE_STYLES_FILE=/secrets/office-styles.json@OFFICE_STYLES_LOCKED=${OFFICE_STYLES_LOCKED:-false}"
fi

# Az irodai playbookok (a „Playbookok kezelése → Exportálás” fájlja), ha van ilyen titok
if secret_exists playbooks; then
  grant_secret playbooks
  SECRETS="$SECRETS,/secrets/playbooks.json=playbooks:latest"
  STYLES_ENV="$STYLES_ENV@PLAYBOOKS_FILE=/secrets/playbooks.json"
fi

step "Beállítások"
# A @ az elválasztó (^@^), mert a domainlistában vessző lehet
ENV_VARS="^@^AI_PROVIDER=$AI_PROVIDER@AUTH_MODE=$AUTH_MODE$STYLES_ENV"
if [ "$AI_PROVIDER" = "vertex" ]; then
  ENV_VARS="$ENV_VARS@GOOGLE_CLOUD_PROJECT=$PROJECT@GOOGLE_CLOUD_LOCATION=$VERTEX_LOCATION"
fi
if [ "$AUTH_MODE" != "key" ]; then
  : "${MS_CLIENT_ID:?AUTH_MODE=$AUTH_MODE mellett MS_CLIENT_ID is kell}" "${MS_TENANT_ID:?és MS_TENANT_ID is}"
  ENV_VARS="$ENV_VARS@MS_CLIENT_ID=$MS_CLIENT_ID@MS_TENANT_ID=$MS_TENANT_ID"
  if [ -n "${MS_ALLOWED_DOMAINS:-}" ]; then ENV_VARS="$ENV_VARS@MS_ALLOWED_DOMAINS=$MS_ALLOWED_DOMAINS"; fi
fi
for name in AI_MODEL AI_MODEL_DEEP MASKING_POLICY DICTATION_POLICY; do
  if [ -n "${!name:-}" ]; then ENV_VARS="$ENV_VARS@$name=${!name}"; fi
done
echo "AI: $AI_PROVIDER, belépés: $AUTH_MODE, régió: $REGION"

step "Verzió (a Beállítások alján látszik)"
printf '{"commit":"%s","date":"%s"}\n' "$(git rev-parse --short HEAD)" "$(git log -1 --format=%cs)" > version.json
cat version.json

step "Építés és telepítés (pár perc)"
# --timeout: egy alapos átvizsgálás percekig tarthat (a szerver legfeljebb 8 percet vár a modellre)
gcloud run deploy "$SERVICE" --source . --region "$REGION" \
  --service-account "$SA" --allow-unauthenticated \
  --timeout=900 --memory=1Gi --cpu=1 --min-instances="$MIN_INSTANCES" --max-instances=3 \
  --set-env-vars "$ENV_VARS" --set-secrets "$SECRETS"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
step "Kész"
echo "A szerver címe:   $URL"
echo "A manifest:       $URL/manifest.xml"
echo "Ellenőrzés:       curl -s $URL/api/auth-mode"
echo
echo "Következő lépés: a manifestet a Microsoft 365 felügyeleti központban kell kiadni (docs/FELHO-TELEPITES.md, 5. lépés)."
if [ "$AUTH_MODE" != "key" ]; then
  echo "Az Azure-ban az Application ID URI legyen: api://${URL#https://}/$MS_CLIENT_ID"
fi
