# Ayaan — Antigravity Memory

A memory game for a 6-year-old. Friendly shapes float in zero gravity, light up in a
sequence, and Ayaan taps them back in the same order. Plain HTML/CSS/JavaScript,
wrapped as an Android app with Capacitor and built into an APK by GitHub Actions.

## Directory tree

```
ayaan-game/
├── .github/workflows/build-apk.yml   # builds the APK on every push
├── .gitignore
├── README.md
├── capacitor.config.json             # app id, name, web folder
├── package.json                      # Capacitor 7
└── www/
    ├── index.html                    # markup
    ├── style.css                     # mobile-first styling
    └── script.js                     # game logic, physics, sound, input
```

The `android/` project is not stored in the repo. The workflow generates it on the
first run, so you never need Android Studio.

## Get the APK

1. Create a new GitHub repository and push this folder to the `main` branch.
2. Open the **Actions** tab, then the **Build Android APK** run.
3. When it turns green (about 5–10 minutes the first time), scroll to **Artifacts**
   and download **Ayaan-debug-apk**. Unzip it to get `app-debug.apk`.
4. Copy the APK to the Android device and open it. Android will ask you to allow
   installing from this source. This is normal for apps outside the Play Store.

You can also start a build by hand: Actions, Build Android APK, **Run workflow**.

Tip: after the first successful run, commit the `package-lock.json` file that
`npm install` creates, so later builds use exactly the same package versions.

## Play it in a browser (no build needed)

```
npm run serve        # then open http://localhost:8080
```

or just open `www/index.html`. Add `#level=2` or `#level=3` to the address to jump
to a level.

## How it plays

| Level | Shapes | Movement |
|-------|--------|----------|
| 1 | 3 | Stationary (gentle bobbing in place) |
| 2 | 4 | Slow drift, turning around softly near the edges |
| 3 | 5 | Moderate drift, bouncing off the edges |

Each level is 3 rounds, with one star per round. While the sequence is shown, the shapes
hold still so the order is easy to learn. They start drifting when it is Ayaan's turn.
A wrong tap gets a soft wobble and a soft sound, then the same sequence is shown again.
There are no lives and no timer.

Every shape has its own colour, outline and musical note, so none of them depends on
colour alone (colour-blind safe palette).

## Tuning

Everything you are likely to change sits at the top of `www/script.js`: the `LEVELS`
table (count, speed, edge behaviour, rounds), how long shapes stay lit, and how
forgiving the tap area is.

## Notes

- The APK is a debug build, signed with Android's debug key. It installs fine on a
  device, but it is not suitable for the Play Store. A release build needs your own
  signing key.
- The build uses Capacitor 7, which needs JDK 21 and Node 20 or newer. The workflow
  already sets this up.
