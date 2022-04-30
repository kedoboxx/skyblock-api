# SkyBlock API

Backend for [skyblock.matdoes.dev](https://github.com/skyblockstats/skyblock-stats).

This is kinda like [Slothpixel](https://github.com/slothpixel/core), it fetches the SkyBlock API and cleans up the result for use without an API key.

## Basically what it does

1. A request is sent to the Express server in index.js
2. The express server then calls a function in hypixelCached depending on the request
3. hypixelCached will either directly return already-cached data, or continue to hypixel.ts
4. hypixel.ts will call hypixelApi to get the raw data from the Hypixel API
5. hypixel.ts calls one or more of the cleaners, which pretties up the data for us to use
6. cleaned data is returned to hypixelCached, which will cache it
7. Data is sent back to express to serve to the user

## API conventions

If you (this is really just here for myself so I don't forget) are adding a new API thing, follow these rules so the API is consistent with how it responds:

- Use camelCase for keys.
- Use snake_case for values.
- Prefer arrays over dictionaries when the keys aren't static. For example `[ { name: "asdf", value: "dsfasg" } ]` rather than `{ "asdf": "dsfasg" }`.
- Dates are milliseconds since epoch.
- Fields that contain a snake_case ID should be called `id`. At the moment some of them are called `name`, this will be changed soon.

## Development

First, install the dependencies with `npm i`.
Then to run it, do `tsc -w` in one terminal, `npx nodemon build` in another. This makes it automatically restart when you make a change.
If you don't like it auto restarting, then just do `node build` instead of `npx nodemon build`.

