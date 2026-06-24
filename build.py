#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tatami - build: dati/*.yaml -> grafo.json (con validazione).

Uso:
    python build.py            # valida e genera grafo.json (+ app/grafo.json)
    python build.py --check    # valida soltanto, NON scrive (exit 1 se ci sono ERRORI)

La pagina pubblicata e' statica e a ZERO dipendenze: carica solo grafo.json.
Qui (in fase di build) serve PyYAML, gia' presente sul PC.

Regole del dominio (vedi README.md / specifica):
  - nodi tipo: posizione | sottomissione | esito ; sottomissione/esito sono TERMINALI.
  - ruolo: sotto | sopra ; svantaggio: true marca le "prigioni" (nodi subiti, vivi).
  - archi: da, a, mossa, se_lui?, conquista?, richiede?, perdo_conquista?,
           persiste?, mantieni_se?, esito_negativo?.
  - nodi con stesso id (anche in moduli diversi) = STESSO nodo: il grafo si intreccia.

Validazione:
  ERRORI (bloccano il build):
    - nodo senza id; tipo o ruolo con valore non ammesso;
    - id duplicato con tipo/ruolo in conflitto;
    - arco senza 'da'/'a'; arco verso un id inesistente;
    - arco in uscita da un nodo TERMINALE (sottomissione/esito).
  AVVISI (non bloccano, finiscono in grafo.json -> "avvisi", utili in didattica):
    - 'richiede: X' senza nessun arco che faccia 'conquista: X' (prerequisito mancante = buco);
    - nodo non-terminale senza archi in uscita (vicolo cieco);
    - arco senza 'mossa'.
"""
import sys
import os
import glob
import json
import datetime

try:
    import yaml
except ImportError:
    sys.stderr.write(
        "ERRORE: manca PyYAML. Installa con:  pip install pyyaml\n"
    )
    sys.exit(2)

TIPI = {"posizione", "sottomissione", "esito"}
RUOLI = {"sotto", "sopra"}
TERMINALI = {"sottomissione", "esito"}

ROOT = os.path.dirname(os.path.abspath(__file__))
DATI = os.path.join(ROOT, "dati")

# campi degli archi che vengono propagati cosi' come sono in grafo.json
CAMPI_ARCO = [
    "mossa", "se_lui", "conquista", "richiede", "perdo_conquista",
    "persiste", "mantieni_se", "esito_negativo", "media", "note",
]


def carica_moduli():
    moduli = []
    paths = sorted(
        glob.glob(os.path.join(DATI, "*.yaml")) + glob.glob(os.path.join(DATI, "*.yml"))
    )
    for path in paths:
        try:
            with open(path, encoding="utf-8") as f:
                doc = yaml.safe_load(f) or {}
        except yaml.YAMLError as e:
            mark = getattr(e, "problem_mark", None)
            dove = f" (riga {mark.line + 1}, colonna {mark.column + 1})" if mark else ""
            sys.stderr.write(f"ERRORE di sintassi YAML in {os.path.basename(path)}{dove}:\n")
            sys.stderr.write(f"  {getattr(e, 'problem', e)}\n")
            sys.stderr.write("  Spesso e' un \": \" (due punti + spazio) dentro un testo:\n")
            sys.stderr.write("  metti quel valore tra \"virgolette\" e ricompila.\n")
            sys.exit(1)
        doc["_file"] = os.path.basename(path)
        moduli.append(doc)
    return moduli, paths


def costruisci(moduli):
    """Fonde i moduli in un grafo unico. Ritorna (nodi, archi, errori, avvisi)."""
    errori = []
    avvisi = []
    nodi = {}            # id -> nodo unito
    nodi_modulo = {}     # id -> set(moduli che lo definiscono)
    archi = []

    for doc in moduli:
        modulo = doc.get("modulo") or doc.get("_file")
        if not doc.get("modulo"):
            avvisi.append(f"[{doc['_file']}] manca il campo 'modulo' (uso il nome file)")

        # ---- nodi ----
        for raw in (doc.get("posizioni") or []):
            nid = raw.get("id")
            if not nid:
                errori.append(f"[{modulo}] nodo senza 'id': {raw}")
                continue
            tipo = raw.get("tipo", "posizione")
            ruolo = raw.get("ruolo")
            if tipo not in TIPI:
                errori.append(f"[{modulo}] nodo '{nid}': tipo non valido '{tipo}' (ammessi: {sorted(TIPI)})")
            if ruolo is not None and ruolo not in RUOLI:
                errori.append(f"[{modulo}] nodo '{nid}': ruolo non valido '{ruolo}' (ammessi: {sorted(RUOLI)})")

            nodi_modulo.setdefault(nid, set()).add(modulo)

            nomi = raw.get("nomi") or None
            if nid not in nodi:
                nodi[nid] = {
                    "id": nid,
                    "nome": raw.get("nome") or (nomi and (nomi.get("sopra") or nomi.get("sotto"))) or nid,
                    "nomi": nomi,
                    "tipo": tipo,
                    "ruolo": ruolo,
                    "svantaggio": bool(raw.get("svantaggio", False)),
                    "conquiste_possibili": list(raw.get("conquiste_possibili") or []),
                    "media": raw.get("media"),
                    "note": raw.get("note"),
                }
            else:
                # stesso id in piu' moduli = stesso nodo: unisci, ma segnala i conflitti
                n = nodi[nid]
                if raw.get("tipo") and raw["tipo"] != n["tipo"]:
                    errori.append(f"[{modulo}] id duplicato '{nid}': tipo in conflitto '{n['tipo']}' vs '{raw['tipo']}'")
                if ruolo and n["ruolo"] and ruolo != n["ruolo"]:
                    errori.append(f"[{modulo}] id duplicato '{nid}': ruolo in conflitto '{n['ruolo']}' vs '{ruolo}'")
                if ruolo and not n["ruolo"]:
                    n["ruolo"] = ruolo
                n["svantaggio"] = n["svantaggio"] or bool(raw.get("svantaggio", False))
                for c in (raw.get("conquiste_possibili") or []):
                    if c not in n["conquiste_possibili"]:
                        n["conquiste_possibili"].append(c)
                if not n["nome"] or n["nome"] == nid:
                    n["nome"] = raw.get("nome", n["nome"])
                if not n["note"] and raw.get("note"):
                    n["note"] = raw["note"]
                if not n["media"] and raw.get("media"):
                    n["media"] = raw["media"]
                if not n.get("nomi") and nomi:
                    n["nomi"] = nomi

        # ---- archi ----
        for raw in (doc.get("transizioni") or []):
            da, a = raw.get("da"), raw.get("a")
            if not da or not a:
                errori.append(f"[{modulo}] arco senza 'da'/'a': {raw}")
                continue
            arco = {"source": da, "target": a, "modulo": modulo}
            for k in CAMPI_ARCO:
                if k in raw:
                    arco[k] = raw[k]
            arco["esito_negativo"] = bool(raw.get("esito_negativo", False))
            arco["persiste"] = bool(raw.get("persiste", False))
            if not raw.get("mossa"):
                avvisi.append(f"[{modulo}] arco {da} -> {a}: manca 'mossa'")
            archi.append(arco)

    # registra i moduli su ogni nodo
    for nid, mods in nodi_modulo.items():
        nodi[nid]["moduli"] = sorted(mods)

    return nodi, archi, errori, avvisi


def valida(nodi, archi, errori, avvisi):
    ids = set(nodi)

    # archi verso id inesistenti + archi in uscita da nodi terminali
    out_degree = {nid: 0 for nid in ids}
    conquiste_offerte = set()
    for arco in archi:
        da, a = arco["source"], arco["target"]
        if da not in ids:
            errori.append(f"[{arco['modulo']}] arco da id inesistente: '{da}' -> '{a}'")
        if a not in ids:
            errori.append(f"[{arco['modulo']}] arco verso id inesistente: '{da}' -> '{a}'")
        if da in nodi and nodi[da]["tipo"] in TERMINALI:
            errori.append(f"[{arco['modulo']}] arco in uscita da nodo TERMINALE '{da}' ({nodi[da]['tipo']}): non ammesso")
        if da in out_degree:
            out_degree[da] += 1
        if arco.get("conquista"):
            conquiste_offerte.add(arco["conquista"])

    # prerequisiti mancanti: richiede X senza alcun conquista X (= buco)
    for arco in archi:
        req = arco.get("richiede")
        if req and req not in conquiste_offerte:
            avvisi.append(
                f"[{arco['modulo']}] BUCO: arco {arco['source']} -> {arco['target']} "
                f"richiede '{req}' ma nessun arco offre 'conquista: {req}'"
            )

    # vicoli ciechi: nodo non-terminale senza archi in uscita
    for nid, nodo in nodi.items():
        if nodo["tipo"] not in TERMINALI and out_degree.get(nid, 0) == 0:
            avvisi.append(f"BUCO: nodo '{nid}' ({nodo['nome']}) non-terminale senza archi in uscita (vicolo cieco)")

    return errori, avvisi


def main():
    solo_check = "--check" in sys.argv
    moduli, paths = carica_moduli()
    if not paths:
        sys.stderr.write(f"Nessun file .yaml in {DATI}\n")
        sys.exit(1)

    nodi, archi, errori, avvisi = costruisci(moduli)
    errori, avvisi = valida(nodi, archi, errori, avvisi)

    print(f"Moduli: {len(moduli)}  |  nodi: {len(nodi)}  |  archi: {len(archi)}")
    for a in avvisi:
        print(f"  AVVISO  {a}")
    for e in errori:
        print(f"  ERRORE  {e}")

    if errori:
        print(f"\n{len(errori)} ERRORE/I: build interrotto.")
        sys.exit(1)

    if solo_check:
        print(f"\nOK (solo --check): {len(avvisi)} avviso/i, 0 errori. Nessun file scritto.")
        return

    grafo = {
        "meta": {
            "generato": datetime.datetime.now().isoformat(timespec="seconds"),
            "moduli": sorted({(d.get("modulo") or d["_file"]) for d in moduli}),
            "n_nodi": len(nodi),
            "n_archi": len(archi),
            "avvisi": avvisi,
        },
        "nodes": list(nodi.values()),
        "links": archi,
    }

    testo = json.dumps(grafo, ensure_ascii=False, indent=2)
    for dest in (os.path.join(ROOT, "grafo.json"), os.path.join(ROOT, "app", "grafo.json")):
        with open(dest, "w", encoding="utf-8") as f:
            f.write(testo)
        print(f"  scritto  {os.path.relpath(dest, ROOT)}")

    print(f"\nOK: {len(avvisi)} avviso/i, 0 errori.")


if __name__ == "__main__":
    main()
