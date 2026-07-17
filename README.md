# Jag Content Engine

Motore AI **completamente automatico** per la pubblicazione dei contenuti social di [jag.best](https://jag.best).
Ogni giorno seleziona un prodotto dal catalogo, genera un post ottimizzato con OpenAI e lo pubblica su **Instagram** tramite [Zernio](https://zernio.com).

## Flusso

```
GitHub Actions (giornaliero)
        ↓
Legge il catalogo prodotti (Google Sheets)
        ↓
Estrae l'ID prodotto dal link + confronta con lo storico
        ↓
Seleziona il prodotto migliore (scoring multi-fattore)
        ↓
Scarica e valida l'immagine
        ↓
Genera caption, hashtag, CTA e alt text (OpenAI)
        ↓
Pubblica su Instagram (Zernio)
        ↓
Aggiorna lo storico (data/history.json)
```

Il Google Sheet resta **solo sorgente dati**: non viene mai modificato. Lo storico dei
prodotti già pubblicati vive nel repository in `data/history.json`.

## Struttura

```
.github/workflows/daily.yml   # esecuzione giornaliera + trigger manuale
config/
  settings.json               # modelli, pesi di scoring, mappatura colonne, Zernio
  prompts.json                # prompt OpenAI (system + user)
  hashtags.json               # hashtag base e per categoria
  categories.json             # alias categorie, stagionalità, fasce di prezzo
src/
  google/sheet.ts             # lettura catalogo Google Sheets
  ai/product-selector.ts      # selezione intelligente (scoring)
  ai/content-generator.ts     # generazione contenuti OpenAI
  social/zernio.ts            # upload media + pubblicazione Instagram
  storage/history.ts          # storico pubblicazioni
  utils/                      # config, logger, immagini, normalizzazione
  index.ts                    # orchestratore
data/history.json             # storico (aggiornato automaticamente)
```

## Configurazione (GitHub Secrets)

| Secret | Descrizione |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT` | JSON della chiave del Service Account |
| `GOOGLE_SHEET_ID` | ID del foglio catalogo |
| `GOOGLE_SHEET_GID` | GID della scheda da leggere |
| `OPENAI_API_KEY` | Chiave OpenAI |
| `ZERNIO_API_KEY` | Chiave Zernio |
| `ZERNIO_INSTAGRAM_ACCOUNT_ID` | *(facoltativo)* ID account Instagram su Zernio. Se assente viene rilevato automaticamente |

Tutti i parametri non segreti (modello OpenAI, pesi di scoring, tono, hashtag, mappatura
colonne del foglio, stagionalità…) sono in `config/*.json`: nessun valore hardcoded nel codice.

## Uso

```bash
npm install

# Anteprima SENZA pubblicare e senza toccare lo storico
npm run dry-run

# Esecuzione completa (legge, genera, pubblica, aggiorna storico)
npm start

# Controllo dei tipi
npm run typecheck
```

In locale copia `.env.example` in `.env` e compila i valori.

### Esecuzione manuale su GitHub

Vai su **Actions → Daily Content Publish → Run workflow**. È disponibile l'opzione
`dry_run` per provare tutto il flusso senza pubblicare.

## Come funziona la selezione

La scelta non è casuale: ogni prodotto **mai pubblicato** riceve un punteggio che combina
(pesi in `config/settings.json`):

- **varietà del brand** rispetto alle ultime pubblicazioni;
- **varietà della categoria**;
- **stagionalità** (categoria × mese corrente);
- **fascia di prezzo**;
- **qualità dell'immagine**;
- **bilanciamento del feed**.

Viene scelto il candidato con punteggio più alto la cui immagine è effettivamente
scaricabile e valida (in caso contrario si passa al successivo).

## Requisiti per la pubblicazione su Instagram

- L'account Instagram deve essere **Business o Creator** e **collegato su Zernio**
  (gli account personali non possono pubblicare via API).
- L'immagine deve rientrare nei limiti Instagram (≤ 8MB, rapporto tra 4:5 e 1.91:1).

## Evoluzioni future

Caroselli, Reel, Stories, altri canali (Pinterest, LinkedIn, TikTok, Threads),
analisi performance, A/B testing, best time to post, trend detection, formati editoriali
(Product of the Day, Brand Spotlight, ecc.). L'architettura è modulare per estendersi
facilmente.
