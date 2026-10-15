# KNHS Jury Scoring

Web applicatie waarmee de jury tijdens een KNHS dressuurwedstrijd punten invoert. Het klassement en de ruiter die in de baan is worden live getoond op een smart tv.

## Hoe het werkt

Er draait een kleine server op een laptop bij de wedstrijd. Jury en tv verbinden via hetzelfde wifi netwerk met die laptop. Er is geen internet nodig.

| Pagina | Adres | Voor wie |
| --- | --- | --- |
| Jury invoer | `http://<ip van laptop>:3000/jury` | Jury op laptop of tablet |
| Tv weergave | `http://<ip van laptop>:3000/tv` | Browser van de smart tv |

## Starten

Benodigd: [Node.js](https://nodejs.org) versie 18 of hoger. Er hoeft verder niets geïnstalleerd te worden.

```
cd jury
node server.js
```

De server toont bij het starten de juiste adressen voor jury en tv.

Optionele instellingen:

```
JURY_PIN=1234 node server.js      # jury moet een pincode invoeren
PORT=8080 node server.js          # andere poort
```

Alle gegevens worden automatisch opgeslagen in `jury/data/wedstrijd.json`. Na een herstart staat alles er dus nog.

## Werkwijze op de wedstrijddag

1. **Proeven**: maak per proef de onderdelen aan, één per regel. Zet een coëfficiënt achter een puntkomma, bijvoorbeeld `Stap; 2`. Neem ook de algemene punten op. Stel het aantal juryleden en de aftrek per fout in (standaard 2 en 4 punten, bij de derde fout uitsluiting).
2. **Startlijst**: voeg deelnemers toe of plak een lijst uit Excel (startnummer, ruiter, paard, vereniging).
3. **Scoren**: kies de deelnemer en druk op *Zet op tv als in de baan*. Vul de punten in met het toetsenbord (Enter gaat naar het volgende onderdeel) of met de snelknoppen. Twee keer op hetzelfde cijfer tikken geeft een halve punt. Alles wordt direct opgeslagen.
4. Druk op **Afronden** als de proef klaar is. De deelnemer krijgt dan een plaats in het klassement.
5. **Uitslag**: afdrukken of exporteren als CSV.

## Berekening

* Punten per onderdeel van 0 tot 10, halve punten toegestaan, vermenigvuldigd met de coëfficiënt.
* Van het totaal gaat de aftrek voor fouten en eventuele overige aftrek af.
* Percentage is het netto totaal gedeeld door het maximum.
* Bij meerdere juryleden is het eindpercentage het gemiddelde van de juryleden en zijn de punten opgeteld.
* Gelijke percentages (op drie decimalen) krijgen dezelfde plaats.

## Tv

* Groot en goed leesbaar op 16:9, ook met oudere smart tv browsers.
* Bovenaan staat de ruiter die in de baan is met de tussenstand. Dit kan uit bij *TV en wedstrijd*.
* Bij een lange startlijst wisselt de tv automatisch van pagina.
* Op *Automatisch* volgt de tv de proef van de ruiter in de baan. Is er niemand in de baan, dan wisselt de tv tussen alle proeven.
