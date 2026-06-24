# tatami — linguaggio e visualizzatore del gioco di BJJ

Archivio del gioco di Beppe + strumento didattico per gli allievi.
Il gioco è un **grafo orientato**: posizioni, transizioni (mosse), reazioni dell'avversario,
conquiste (prerequisiti invisibili), esiti e svantaggi. Si scrive in **YAML**; uno script lo
valida e genera `grafo.json`; una pagina **statica** lo mostra come **grafo 3D** navigabile,
apribile e condivisibile da telefono con un solo URL.

## Comandi (pochi, anche da telefono)

```bash
python build.py            # valida i moduli e genera grafo.json (+ app/grafo.json)
python build.py --check    # valida soltanto (exit 1 se ci sono ERRORI), non scrive

# anteprima locale (poi apri http://localhost:8000/ nel browser)
cd app && python -m http.server 8000
```

## Struttura

```
tatami/
  dati/            # i moduli .yaml — li scrive Beppe (un file per modulo)
  app/             # la pagina statica: index.html + app.js + style.css + grafo.json
  build.py         # dati/*.yaml -> grafo.json (con validazione)
  grafo.json       # generato (copia canonica; l'app usa app/grafo.json)
  README.md
```

> Web root = `app/`. Il deploy pubblica la cartella `app/`. `build.py` scrive `grafo.json`
> sia nella radice (copia canonica, vedi specifica) sia in `app/grafo.json` (quella che la
> pagina carica).

## Schema YAML

Un file per modulo. Nodi con lo **stesso `id`** (anche in moduli diversi) sono lo **stesso
nodo**: così i moduli si intrecciano in un grafo unico.

```yaml
modulo: <nome>
descrizione: <testo>
prospettiva_default: sotto      # sotto | sopra

posizioni:
  - id: <slug>                  # OBBLIGATORIO, univoco
    nome: <nome mostrato>
    nomi:                       # opz. — STESSA posizione, due nomi-per-prospettiva
      sotto: <come la chiama chi sta sotto>
      sopra: <come la chiama chi sta sopra>
    tipo: posizione             # posizione (default) | sottomissione | esito  (gli ultimi due TERMINALI)
    ruolo: sotto                # sotto | sopra (prospettiva di chi gioca il ramo)
    svantaggio: false           # true = "prigione" (nodo subìto ma vivo: difese/fughe)
    conquiste_possibili: []     # conquiste ottenibili in questo nodo
    media: { foto: <url>, video: <url> }   # SOLO URL (Drive/YouTube), mai file locali
    note: <testo>

transizioni:
  - da: <id>
    a: <id>
    mossa: <testo>
    se_lui: <reazione>          # opz. — la reazione avversaria che innesca QUESTO arco
    conquista: <nome>           # opz. — l'arco OTTIENE un prerequisito (non chiude il ramo)
    richiede: <nome>            # opz. — l'arco è percorribile SOLO se possiedi quella conquista
    perdo_conquista: <nome>     # opz. — l'arco fa PERDERE una conquista
    persiste: true              # opz. — la conquista ottenuta è persistente (viaggia tra le posizioni)
    mantieni_se: <condizione>   # opz. — condizione CONTINUA che mantiene una conquista persistente
    esito_negativo: false       # true = l'arco è "andato male" (porta tipicamente a uno svantaggio)
    media: { video: <url> }
    note: <testo>
```

### Regole del dominio (riassunto)

- **Tre fine-ramo riuscita**, con regole opposte sull'arrivo:
  1. **Sottomissione** (`tipo: sottomissione`): il match finisce.
  2. **Inversione** (`tipo: esito`): lo sweep. Il successo è il cambio di relazione
     sotto→sopra: **la posizione di arrivo NON si nomina mai** (falsa precisione).
  3. **Avanzamento** (`tipo: esito`): sali di gerarchia stando già sopra: qui **l'arrivo si
     nomina sempre** (passare la guardia ≠ prendere la schiena). Molti "avanzamenti" però
     non chiudono il ramo: quelli sono **conquiste**, non esiti.
- **Conquiste** = stati che possiedi dentro una posizione (sbilanciamento, underhook,
  esgrima…), invisibili all'arbitro, che **sbloccano** archi (`richiede`). Locali al nodo per
  default; `persiste: true` le fa viaggiare (raro: l'esgrima), con `mantieni_se`.
- **Esiti negativi & svantaggi**: "finire male" è un **arco** (`esito_negativo`), non un
  nodo; ti deposita in un **nodo di svantaggio** (`svantaggio: true`), vivo, da cui parte il
  gioco difensivo. Marchiamo l'evento (arco), non il luogo (nodo).

## Validazione (cosa controlla `build.py`)

**ERRORI** (bloccano il build):
- nodo senza `id`; `tipo`/`ruolo` con valore non ammesso;
- `id` duplicato con `tipo`/`ruolo` in conflitto;
- arco senza `da`/`a`; arco verso un `id` inesistente;
- arco in uscita da un nodo terminale (sottomissione/esito).

**AVVISI** (non bloccano; finiscono in `grafo.json → meta.avvisi`, visibili in pagina come
"buchi del gioco"):
- `richiede: X` senza nessun arco che faccia `conquista: X` → **prerequisito mancante**;
- nodo non-terminale senza archi in uscita → **vicolo cieco**;
- arco senza `mossa`.

## La pagina (MVP)

- Grafo 3D (`3d-force-graph`), touch/responsive, pensata per il telefono.
- Colore per **tipo** (posizione/sottomissione/esito), **svantaggio** (prigioni arancioni
  ben riconoscibili) e **ruolo**; archi con freccia, stile diverso per `esito_negativo`
  (rosso), `conquista` (oro), `richiede` (viola).
- Click su nodo/arco → **pannello dettaglio** con note, conquiste, e **foto/video da URL**.
- **Filtro per modulo** + elenco **avvisi/buchi**.

## Media: solo URL

Una pagina aperta sul telefono non legge i file del PC: foto e video sono **sempre URL**
(Google Drive con "chiunque abbia il link", oppure YouTube non in elenco). La pagina gestisce
i link Drive (`/file/d/ID/…` o `?id=ID`) e YouTube, con un link "apri originale" di sicurezza.

## Deploy (da impostare — vedi più sotto nel progetto)

Pagina **statica** → hosting gratuito (Cloudflare Pages / GitHub Pages / Netlify) per un URL
pubblico stabile. Anteprima dev da telefono via tunnel (`cloudflared`). Vedi le note di deploy
quando attiviamo il passo 6.
