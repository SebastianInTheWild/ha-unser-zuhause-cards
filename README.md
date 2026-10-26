# Unser Zuhause – Karten

Alle Karten für das Dashboard „Unser Zuhause“ in einem Paket. Jede Karte lässt sich auch einzeln auf jedem anderen Dashboard verwenden. Du findest sie im Kartenauswahl-Dialog unter „Benutzerdefiniert“.

| Karte | Typ | Inhalt |
|---|---|---|
| Energiefluss – Aktuell | `custom:uz-energy-now-card` | aktuelle Leistung mit Akkustand, Daten aus dem Energie-Dashboard |
| Energiefluss – Heute | `custom:uz-energy-day-card` | Energie seit Mitternacht mit Anteilen der Quellen |
| Videoüberwachung | `custom:uz-camera-grid-card` | je Kamera Name und Live-Bild, Anordnung per Drag & Drop |
| System-Status | `custom:uz-system-status-card` | Zustand des HA-Servers mit Farbindex (Score, Updates, Reparaturen, Fehler) |
| Zombies | `custom:uz-zombie-card` | nicht verfügbare Entitäten nach Integration – ignorieren oder löschen |
| Link-Kachel | `custom:uz-link-tile` | Kachel, die eine Unterseite des Dashboards öffnet |
| Einklappbar | `custom:uz-collapsible-card` | Abschnitt mit Unterkarten, auf dem Handy eingeklappt |
| Badge-Leiste | `custom:uz-badge-row` | Badges mit Aktionen beim Antippen |

## Installation

1. HACS → ⋮ → **Benutzerdefinierte Repositories** → URL dieses Repositories, Typ **Dashboard**
2. „Unser Zuhause – Karten“ herunterladen
3. Browser mit Strg+Shift+R neu laden

Für das Dashboard „Unser Zuhause“ brauchst du dieses Paket zusätzlich zur Strategy.

## Videoüberwachung

```yaml
type: custom:uz-camera-grid-card
title: Kameras            # optional
columns: 2                # 1–4, auf dem Handy immer 1
live: true                # Live-Stream; false = Standbild, alle 10 s aktualisiert
aspect_ratio: "16:9"
cameras:                  # leer = alle Kameras
  - camera.hof
  - entity: camera.garten
    wide: true            # über 2 Spalten
```

Im Editor ordnest du die Kameras per Ziehen an. Auf dem Handy tippst du eine Kamera an und dann das Ziel. ⇔ macht eine Kamera doppelt breit, ✕ entfernt sie.

## Energiefluss

Netz, PV, Batterie, Wasser und Geräte holen die Karten selbst aus dem Energie-Dashboard. Leistungssensoren, Akkustand und Geräte stellst du im Editor der Karte ein.

```yaml
type: custom:uz-energy-now-card
battery_soc: sensor.battery_level
devices: [Wallbox, Heizung]
```

## Lizenz

MIT · Autor: SebastianInTheWild
