import { CleanBasicMember, CleanMember, cleanSkyBlockProfileMemberResponse, cleanSkyBlockProfileMemberResponseBasic } from './member.js'
import { SkyBlockProfilesResponse as HypixelApiSkyBlockProfilesResponse } from 'typed-hypixel-api/build/responses/skyblock/profiles'
import { CleanMinion, combineMinionArrays, countUniqueMinions } from './minions.js'
import * as constants from '../../constants.js'
import { ApiOptions } from '../../hypixel.js'
import { Bank, cleanBank } from './bank.js'

export interface CleanProfile extends CleanBasicProfile {
    members?: CleanBasicMember[]
}

export interface CleanFullProfile extends CleanProfile {
    members: CleanMember[]
    bank: Bank
    minions: CleanMinion[]
    minionCount: number
    maxUniqueMinions: number
}

export interface CleanFullProfileBasicMembers extends CleanProfile {
    members: CleanBasicMember[]
    bank: Bank
    minions: CleanMinion[]
    minionCount: number
    maxUniqueMinions: number
}

/** Return a `CleanProfile` instead of a `CleanFullProfile`, useful when we need to get members but don't want to waste much ram */
export async function cleanSkyblockProfileResponseLighter(data): Promise<CleanProfile> {
    // We use Promise.all so it can fetch all the usernames at once instead of waiting for the previous promise to complete
    const promises: Promise<CleanBasicMember | null>[] = []

    for (const memberUUID in data.members) {
        const memberRaw = data.members[memberUUID]
        memberRaw.uuid = memberUUID
        // we pass an empty array to make it not check stats
        promises.push(cleanSkyBlockProfileMemberResponseBasic(memberRaw))
    }

    const cleanedMembers: CleanBasicMember[] = (await Promise.all(promises)).filter(m => m) as CleanBasicMember[]

    return {
        uuid: data.profile_id,
        name: data.cute_name,
        members: cleanedMembers,
    }
}

/**
 * This function is somewhat costly and shouldn't be called often. Use cleanSkyblockProfileResponseLighter if you don't need all the data
 */
export async function cleanSkyblockProfileResponse<O extends ApiOptions>(data: HypixelApiSkyBlockProfilesResponse['profiles'][number], options?: O): Promise<(O['basic'] extends true ? CleanProfile : CleanFullProfile) | null> {
    // We use Promise.all so it can fetch all the users at once instead of waiting for the previous promise to complete
    const promises: Promise<CleanMember | null>[] = []
    if (!data) return null

    const profileId: string = data.profile_id

    for (const memberUUID in data.members) {
        const memberRaw = data.members[memberUUID]
        const memberRawWithUuid = { ...memberRaw, uuid: memberUUID }
        promises.push(cleanSkyBlockProfileMemberResponse(
            memberRawWithUuid,
            profileId,
            [
                !options?.basic ? 'stats' : undefined,
                options?.mainMemberUuid === memberUUID ? 'inventories' : undefined
            ]
        ))
    }


    const cleanedMembers: CleanMember[] = (await Promise.all(promises)).filter(m => m) as CleanMember[]

    if (options?.basic) {
        const cleanProfile: CleanProfile = {
            uuid: profileId,
            name: data.cute_name,
            members: cleanedMembers,
        }
        // we have to do this because of the basic checking typing
        return cleanProfile as any
    }

    const memberMinions: CleanMinion[][] = []

    for (const member of cleanedMembers) {
        memberMinions.push(member.minions)
    }
    const minions: CleanMinion[] = combineMinionArrays(memberMinions)

    const { max_minions: maxUniqueMinions } = await constants.fetchConstantValues()

    const uniqueMinions = countUniqueMinions(minions)
    if (uniqueMinions > (maxUniqueMinions ?? 0))
        await constants.setConstantValues({ max_minions: uniqueMinions })

    // return more detailed info
    const cleanFullProfile: CleanFullProfile = {
        uuid: data.profile_id,
        name: data.cute_name,
        members: cleanedMembers,
        bank: cleanBank(data),
        minions: minions,
        minionCount: uniqueMinions,
        maxUniqueMinions: maxUniqueMinions ?? 0,
    }
    // we have to do this because of the basic checking typing
    return cleanFullProfile as any
}

/** A basic profile that only includes the profile uuid and name */
export interface CleanBasicProfile {
    uuid: string

    // the name depends on the user, so its sometimes not included
    name?: string
}

