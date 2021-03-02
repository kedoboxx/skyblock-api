/**
 * Store data about members for leaderboards
*/

import * as constants from './constants'
import * as cached from './hypixelCached'
import { Collection, Db, MongoClient } from 'mongodb'
import NodeCache from 'node-cache'
import { CleanMember } from './cleaners/skyblock/member'
import { CleanPlayer } from './cleaners/player'
import { shuffle, sleep } from './util'
import { CleanFullProfile } from './cleaners/skyblock/profile'
import { categorizeStat } from './cleaners/skyblock/stats'
import Queue from 'queue-promise'
import { debug } from '.'

// don't update the user for 3 minutes
const recentlyUpdated = new NodeCache({
	stdTTL: 60 * 3,
	checkperiod: 60,
	useClones: false,
})

interface DatabaseLeaderboardItem {
	uuid: string
	stats: any
	last_updated: Date
}

interface LeaderboardItem {
	player: CleanPlayer
	value: number
}

const cachedRawLeaderboards: Map<string, DatabaseLeaderboardItem[]> = new Map()

const leaderboardMax = 100
const reversedLeaderboards = [
	'first_join',
	'_best_time', '_best_time_2'
]
const leaderboardUnits = {
	time: ['_best_time', '_best_time_2'],
	date: ['first_join'],
	coins: ['purse']
}

let client: MongoClient
let database: Db
let memberLeaderboardsCollection: Collection<any>

async function connect() {
	if (!process.env.db_uri)
		return console.warn('Warning: db_uri was not found in .env. Features that utilize the database such as leaderboards won\'t work.')
	if (!process.env.db_name)
		return console.warn('Warning: db_name was not found in .env. Features that utilize the database such as leaderboards won\'t work.')
	client = await MongoClient.connect(process.env.db_uri, { useNewUrlParser: true, useUnifiedTopology: true })
	database = client.db(process.env.db_name)
	memberLeaderboardsCollection = database.collection('member-leaderboards')
}


function getMemberCollectionAttributes(member: CleanMember) {
	const collectionAttributes = {}
	for (const collection of member.collections) {
		const collectionLeaderboardName = `collection_${collection.name}`
		collectionAttributes[collectionLeaderboardName] = collection.xp
	}
	return collectionAttributes
}

function getMemberSkillAttributes(member: CleanMember) {
	const skillAttributes = {}
	for (const collection of member.skills) {
		const skillLeaderboardName = `skill_${collection.name}`
		skillAttributes[skillLeaderboardName] = collection.xp
	}
	return skillAttributes
}

function getMemberLeaderboardAttributes(member: CleanMember) {
	// if you want to add a new leaderboard for member attributes, add it here (and getAllLeaderboardAttributes)
	return {
		// we use the raw stat names rather than the clean stats in case hypixel adds a new stat and it takes a while for us to clean it
		...member.rawHypixelStats,

		// collection leaderboards
		...getMemberCollectionAttributes(member),

		// skill leaderboards
		...getMemberSkillAttributes(member),

		fairy_souls: member.fairy_souls.total,
		first_join: member.first_join,
		purse: member.purse,
		visited_zones: member.visited_zones.length,
	}
}


export async function fetchAllLeaderboardsCategorized(): Promise<{ [ category: string ]: string[] }> {
	const memberLeaderboardAttributes = await fetchAllMemberLeaderboardAttributes()
	const categorizedLeaderboards: { [ category: string ]: string[] } = {}
	for (const leaderboard of memberLeaderboardAttributes) {
		const { category } = categorizeStat(leaderboard)
		if (!categorizedLeaderboards[category])
			categorizedLeaderboards[category] = []
		categorizedLeaderboards[category].push(leaderboard)
	}

	// move misc to end by removing and readding it
	const misc = categorizedLeaderboards.misc
	delete categorizedLeaderboards.misc
	categorizedLeaderboards.misc = misc

	return categorizedLeaderboards
}


/** Fetch the names of all the leaderboards */
export async function fetchAllMemberLeaderboardAttributes(): Promise<string[]> {
	return [
		// we use the raw stat names rather than the clean stats in case hypixel adds a new stat and it takes a while for us to clean it
		...await constants.fetchStats(),

		// collection leaderboards
		...(await constants.fetchCollections()).map(value => `collection_${value}`),

		// skill leaderboards
		...(await constants.fetchSkills()).map(value => `skill_${value}`),

		'fairy_souls',
		'first_join',
		'purse',
		'visited_zones',
	]
}

function isLeaderboardReversed(name: string): boolean {
	for (const leaderboardMatch of reversedLeaderboards) {
		let trailingEnd = leaderboardMatch[0] === '_'
		let trailingStart = leaderboardMatch.substr(-1) === '_'
		if (
			(trailingStart && name.startsWith(leaderboardMatch))
			|| (trailingEnd && name.endsWith(leaderboardMatch))
			|| (name == leaderboardMatch)
		)
			return true
	}
	return false
}

function getLeaderboardUnit(name: string): string {
	for (const [ unitName, leaderboardMatchers ] of Object.entries(leaderboardUnits)) {
		for (const leaderboardMatch of leaderboardMatchers) {
			let trailingEnd = leaderboardMatch[0] === '_'
			let trailingStart = leaderboardMatch.substr(-1) === '_'
			if (
				(trailingStart && name.startsWith(leaderboardMatch))
				|| (trailingEnd && name.endsWith(leaderboardMatch))
				|| (name == leaderboardMatch)
			)
				return unitName
		}
	}
}

async function fetchMemberLeaderboardRaw(name: string): Promise<DatabaseLeaderboardItem[]> {
	if (cachedRawLeaderboards.has(name))
		return cachedRawLeaderboards.get(name)
	// typescript forces us to make a new variable and set it this way because it gives an error otherwise
	const query = {}
	query[`stats.${name}`] = { '$exists': true, '$ne': NaN }

	const sortQuery: any = {}
	sortQuery[`stats.${name}`] = isLeaderboardReversed(name) ? 1 : -1

	const leaderboardRaw = await memberLeaderboardsCollection.find(query).sort(sortQuery).limit(leaderboardMax).toArray()
	cachedRawLeaderboards.set(name, leaderboardRaw)
	return leaderboardRaw
}

export async function fetchMemberLeaderboard(name: string) {
	const leaderboardRaw = await fetchMemberLeaderboardRaw(name)
	const fetchLeaderboardPlayer = async(item: DatabaseLeaderboardItem): Promise<LeaderboardItem> => {
		return {
			player: await cached.fetchBasicPlayer(item.uuid),
			value: item.stats[name]
		}
	}
	const promises: Promise<LeaderboardItem>[] = []
	for (const item of leaderboardRaw) {
		promises.push(fetchLeaderboardPlayer(item))
	}
	const leaderboard = await Promise.all(promises)
	return {
		name: name,
		unit: getLeaderboardUnit(name) ?? null,
		list: leaderboard
	}
}

async function getMemberLeaderboardRequirement(name: string): Promise<number> {
	const leaderboard = await fetchMemberLeaderboardRaw(name)
	// if there's more than 100 items, return the 100th. if there's less, return null
	if (leaderboard.length >= leaderboardMax)
		return leaderboard[leaderboardMax - 1].stats[name]
	else
		return null
}

/** Get the attributes for the member, but only ones that would put them on the top 100 for leaderboards */
async function getApplicableAttributes(member): Promise<{ [key: string]: number }> {
	const leaderboardAttributes = getMemberLeaderboardAttributes(member)
	const applicableAttributes = {}
	for (const [ leaderboard, attributeValue ] of Object.entries(leaderboardAttributes)) {
		const requirement = await getMemberLeaderboardRequirement(leaderboard)
		const leaderboardReversed = isLeaderboardReversed(leaderboard)
		if (!requirement || leaderboardReversed ? attributeValue < requirement : attributeValue > requirement)
			applicableAttributes[leaderboard] = attributeValue
	}
	return applicableAttributes
}

/** Update the member's leaderboard data on the server if applicable */
export async function updateDatabaseMember(member: CleanMember, profile: CleanFullProfile) {
	if (!client) return // the db client hasn't been initialized
	// the member's been updated too recently, just return
	if (recentlyUpdated.get(profile.uuid + member.uuid))
		return
	// store the member in recentlyUpdated so it cant update for 3 more minutes
	recentlyUpdated.set(profile.uuid + member.uuid, true)

	if (debug) console.log('adding member to leaderboards', member.username)

	await constants.addStats(Object.keys(member.rawHypixelStats))
	await constants.addCollections(member.collections.map(coll => coll.name))
	await constants.addSkills(member.skills.map(skill => skill.name))
	await constants.addZones(member.visited_zones.map(zone => zone.name))

	const leaderboardAttributes = await getApplicableAttributes(member)

	await memberLeaderboardsCollection.updateOne(
		{
			uuid: member.uuid,
			profile: profile.uuid
		},
		{
			'$set': {
				stats: leaderboardAttributes,
				last_updated: new Date()
			}
		},
		{ upsert: true }
	)

	for (const [ attributeName, attributeValue ] of Object.entries(leaderboardAttributes)) {
		const existingRawLeaderboard = await fetchMemberLeaderboardRaw(attributeName)
		const leaderboardReverse = isLeaderboardReversed(attributeName)
		const newRawLeaderboard = existingRawLeaderboard
			// remove the player from the leaderboard, if they're there
			.filter(value => value.uuid !== member.uuid)
			.concat([{
				last_updated: new Date(),
				stats: leaderboardAttributes,
				uuid: member.uuid
			}])
			.sort((a, b) => leaderboardReverse ? a.stats[attributeName] - b.stats[attributeName] : b.stats[attributeName] - a.stats[attributeName])
			.slice(0, 100)
		cachedRawLeaderboards.set(attributeName, newRawLeaderboard)
	}

	if (debug) console.log('added member to leaderboards', member.username, leaderboardAttributes)
}

const queue = new Queue({
	concurrent: 10,
	interval: 500
})

/** Queue an update for the member's leaderboard data on the server if applicable */
export async function queueUpdateDatabaseMember(member: CleanMember, profile: CleanFullProfile) {
	queue.enqueue(async() => await updateDatabaseMember(member, profile))
}


/**
 * Remove leaderboard attributes for members that wouldn't actually be on the leaderboard. This saves a lot of storage space
 */
async function removeBadMemberLeaderboardAttributes() {
	const leaderboards = await fetchAllMemberLeaderboardAttributes()
	// shuffle so if the application is restarting many times itll still be useful
	for (const leaderboard of shuffle(leaderboards)) {
		// wait 10 seconds so it doesnt use as much ram
		await sleep(10 * 1000)

		const unsetValue = {}
		unsetValue[leaderboard] = ''
		const filter = {}
		const requirement = await getMemberLeaderboardRequirement(leaderboard)
		const leaderboardReversed = isLeaderboardReversed(leaderboard)
		if (requirement !== null) {
			filter[`stats.${leaderboard}`] = {
				'$lt': leaderboardReversed ? undefined : requirement,
				'$gt': leaderboardReversed ? requirement : undefined
			}
			await memberLeaderboardsCollection.updateMany(
				filter,
				{ '$unset': unsetValue }
			)
		}
	}
}

/** Fetch all the leaderboards, used for caching. Don't call this often! */
async function fetchAllLeaderboards() {
	const leaderboards = await fetchAllMemberLeaderboardAttributes()
	// shuffle so if the application is restarting many times itll still be useful
	if (debug) console.log('Caching leaderboards!')
	for (const leaderboard of shuffle(leaderboards)) {
		// wait 2 seconds so it doesnt use as much ram
		await sleep(2 * 1000)

		await fetchMemberLeaderboard(leaderboard)
	}
	if (debug) console.log('Finished caching leaderboards!')
}


connect().then(() => {
	// when it connects, cache the leaderboards and remove bad members
	removeBadMemberLeaderboardAttributes()
	// cache leaderboards on startup so its faster later on
	fetchAllLeaderboards()
	// cache leaderboard players again every hour
	setInterval(fetchAllLeaderboards, 4 * 60 * 60 * 1000)
})
