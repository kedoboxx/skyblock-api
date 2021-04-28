/**
 * Automatically generate Hypixel API responses for the unit tests
 */

import * as hypixelApi from '../src/hypixelApi'
import * as mojang from '../src/mojang'
import fs from 'fs/promises'
import path from 'path'

const playerUuids = [
	'6536bfed869548fd83a1ecd24cf2a0fd',
	'4133cab5a7534f3f9bb636fc06a1f0fd',
	'ef3bb867eec048a1a9b92b451f0ffc66',
	'e403573808ad45ddb5c48ec7c4db0144',
]

async function writeTestData(requestPath: string, name: string, contents: any) {
	const dir = path.join(__dirname, '..', 'test', 'data', requestPath)
	await fs.mkdir(dir, { recursive: true })
	await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(contents, null, 2))
}

async function addResponse(requestPath: string, args: { [ key: string ]: string }, name: string) {
	const response = await hypixelApi.sendApiRequest({
		path: requestPath,
		args: args,
		key: hypixelApi.chooseApiKey()
	})
	await writeTestData(requestPath, name, response)
}

async function main() {
	const uuidsToUsername = {}
	for (const playerUuid of playerUuids) {
		await addResponse('player', { uuid: playerUuid }, playerUuid)
		await addResponse('skyblock/profiles', { uuid: playerUuid }, playerUuid)
		const { username: playerUsername } = await mojang.profileFromUuid(playerUuid)
		uuidsToUsername[playerUuid] = playerUsername
	}

	await writeTestData('', 'mojang', uuidsToUsername)
}

main()