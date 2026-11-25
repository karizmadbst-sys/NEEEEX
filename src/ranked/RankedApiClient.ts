import { getApiUrl } from '../config/RuntimeConfig';
import type { DeviceProfile } from '../core/Types';
import { i18n } from '../i18n/I18nManager';
import type {
  FriendLookupResponse,
  FriendRequestEntry,
  LeaderboardEntry,
  MailboxStateSnapshot,
  OutgoingFriendRequestEntry,
  PlatformType,
  PlayerGender,
  RankedProfile,
  RankedVaultState,
  ServerOnlineStatus,
  SquadFriendEntry,
} from './RankedTypes';

const CREDENTIALS_STORAGE_KEY = 'nexus_ranked_credentials_v1';

export interface StoredRankedCredentials {
  playerId: string;
  secretToken: string;
}

export function detectRankedPlatform(profile: DeviceProfile): PlatformType {
  if (profile.isAndroid) return 'android';
  if (profile.isIOS) return 'ios';
  if (profile.isTablet) return 'tablet';
  return 'pc';
}

export class RankedApiClient {
  private credentials: StoredRankedCredentials | null = null;
  private cachedProfile: RankedProfile | null = null;
  private readonly platform: PlatformType;

  constructor(deviceProfile: DeviceProfile) {
    this.platform = detectRankedPlatform(deviceProfile);
    this.loadCredentials();
  }

  private loadCredentials(): void {
    try {
      const raw = localStorage.getItem(CREDENTIALS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StoredRankedCredentials>;
      if (typeof parsed.playerId === 'string' && typeof parsed.secretToken === 'string') {
        this.credentials = {
          playerId: parsed.playerId,
          secretToken: parsed.secretToken,
        };
      }
    } catch {
      this.credentials = null;
    }
  }

  private saveCredentials(creds: StoredRankedCredentials): void {
    this.credentials = creds;
    try {
      localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(creds));
    } catch {
      // Ignore storage quota issues
    }
  }

  getCredentials(): StoredRankedCredentials | null {
    return this.credentials;
  }

  setAuthenticatedSession(creds: StoredRankedCredentials, profile: RankedProfile): void {
    this.saveCredentials(creds);
    this.cachedProfile = profile;
  }

  clearCredentials(): void {
    this.credentials = null;
    this.cachedProfile = null;
    try {
      localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
    } catch {
      // Ignore storage removal errors
    }
  }

  getCachedProfile(): RankedProfile | null {
    return this.cachedProfile;
  }

  getPlatform(): PlatformType {
    return this.platform;
  }

  async ensureProfile(preferredName?: string): Promise<RankedProfile> {
    const res = await fetch(getApiUrl('/api/ranked/profile'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: this.credentials?.playerId,
        secretToken: this.credentials?.secretToken,
        name: preferredName,
        platform: this.platform,
      }),
    });
    if (!res.ok) {
      throw new Error(i18n.t('api.err.profileRequest', { status: res.status }));
    }
    const data = (await res.json()) as {
      profile: RankedProfile;
      secretToken: string;
    };
    this.saveCredentials({
      playerId: data.profile.playerId,
      secretToken: data.secretToken,
    });
    this.cachedProfile = data.profile;
    return data.profile;
  }

  async checkUsername(
    username: string,
  ): Promise<{ available: boolean; valid: boolean; cleaned?: string; code?: string; error?: string }> {
    const res = await fetch(getApiUrl('/api/auth/check-username'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.trim(),
        excludePlayerId: this.credentials?.playerId,
      }),
    });
    if (!res.ok) {
      throw new Error(i18n.t('api.err.profileRequest', { status: res.status }));
    }
    return (await res.json()) as {
      available: boolean;
      valid: boolean;
      cleaned?: string;
      code?: string;
      error?: string;
    };
  }

  async registerInitialProfile(
    idToken: string,
    username: string,
  ): Promise<{ playerId: string; numericId: string; username: string }> {
    const res = await fetch(getApiUrl('/api/auth/register-profile'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        username: username.trim(),
        platform: this.platform,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      playerId?: string;
      numericId?: string;
      username?: string;
      error?: string;
      code?: string;
    };
    if (!res.ok || !data.playerId || !data.numericId) {
      throw new Error(data.error || i18n.t('api.err.profileRequest', { status: res.status }));
    }
    return {
      playerId: data.playerId,
      numericId: data.numericId,
      username: data.username || username.trim(),
    };
  }

  async loginWithIdentifier(identifier: string, password: string): Promise<{ email: string }> {
    const res = await fetch(getApiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: identifier.trim(),
        password,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      email?: string;
      error?: string;
      code?: string;
    };
    if (!res.ok || !data.email) {
      throw new Error(data.error || i18n.t('auth.errInvalidCredentials'));
    }
    return { email: data.email };
  }

  async recoverPassword(identifier: string): Promise<string> {
    const res = await fetch(getApiUrl('/api/auth/recover'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: identifier.trim(),
      }),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
    if (!res.ok) {
      throw new Error(data.error || i18n.t('auth.errRecoverFailed'));
    }
    return (
      data.message ||
      i18n.t('auth.recoverSentInfo')
    );
  }

  async renameProfile(newName: string): Promise<RankedProfile> {
    if (!this.credentials) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    if (!creds) {
      throw new Error(i18n.t('api.err.noCredentials'));
    }
    const res = await fetch(getApiUrl('/api/profile/update-username'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: creds.playerId,
        secretToken: creds.secretToken,
        newName,
      }),
    });
    const data = (await res.json()) as { profile?: RankedProfile; error?: string; code?: string };
    if (!res.ok || !data.profile) {
      const serverMsg = data.error
        ? i18n.translateServerMessage(data.error, data.code)
        : i18n.t('api.err.renameFailed', { status: res.status });
      throw new Error(serverMsg);
    }
    this.cachedProfile = data.profile;
    return data.profile;
  }

  async updateProfileGender(gender: PlayerGender): Promise<RankedProfile> {
    if (!this.credentials) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    if (!creds) {
      throw new Error(i18n.t('api.err.noCredentials'));
    }
    const res = await fetch(getApiUrl('/api/profile/update-gender'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: creds.playerId,
        secretToken: creds.secretToken,
        gender,
      }),
    });
    const data = (await res.json()) as { profile?: RankedProfile; error?: string; code?: string };
    if (!res.ok || !data.profile) {
      const serverMsg = data.error
        ? i18n.translateServerMessage(data.error, data.code)
        : i18n.t('api.err.profileRequest', { status: res.status });
      throw new Error(serverMsg);
    }
    this.cachedProfile = data.profile;
    return data.profile;
  }

  async fetchPublicProfile(idOrNumericId: string): Promise<RankedProfile | null> {
    const cleaned = idOrNumericId.trim();
    if (!cleaned || cleaned.length > 64) {
      return null;
    }
    const res = await fetch(
      getApiUrl(`/api/ranked/profile/${encodeURIComponent(cleaned)}?public=1`),
    );
    if (res.status === 404 || res.status === 400) {
      return null;
    }
    if (!res.ok) {
      throw new Error(i18n.t('api.err.fetchProfile', { status: res.status }));
    }
    const data = (await res.json()) as { profile?: RankedProfile };
    return data.profile ?? null;
  }

  async syncAccountProgression(payload: {
    level?: number;
    xp?: number;
    avatarCharacterId?: string;
    gender?: PlayerGender | null;
    brMatch?: {
      kills: number;
      damage: number;
      died: boolean;
      isWinner: boolean;
    };
  }): Promise<RankedProfile | null> {
    if (!this.credentials) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    if (!creds) return null;
    const res = await fetch(getApiUrl('/api/profile/sync-progression'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: creds.playerId,
        secretToken: creds.secretToken,
        ...payload,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { profile?: RankedProfile };
    if (data.profile) {
      this.cachedProfile = data.profile;
      return data.profile;
    }
    return null;
  }

  async syncVaultState(vault: RankedVaultState): Promise<RankedProfile | null> {
    if (!this.credentials) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    if (!creds) return null;
    const res = await fetch(getApiUrl('/api/profile/sync-vault'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: creds.playerId,
        secretToken: creds.secretToken,
        vault,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { profile?: RankedProfile };
    if (data.profile) {
      this.cachedProfile = data.profile;
      return data.profile;
    }
    return null;
  }

  async refreshProfile(): Promise<RankedProfile | null> {
    if (!this.credentials) {
      return this.ensureProfile();
    }
    const res = await fetch(
      getApiUrl(`/api/ranked/profile/${encodeURIComponent(this.credentials.playerId)}`),
    );
    if (res.status === 404) {
      return this.ensureProfile();
    }
    if (!res.ok) {
      throw new Error(i18n.t('api.err.fetchProfile', { status: res.status }));
    }
    const data = (await res.json()) as { profile: RankedProfile };
    this.cachedProfile = data.profile;
    return data.profile;
  }

  async fetchLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
    const res = await fetch(getApiUrl(`/api/ranked/leaderboard?limit=${limit}`));
    if (!res.ok) {
      throw new Error(i18n.t('api.err.leaderboard', { status: res.status }));
    }
    const data = (await res.json()) as { leaderboard: LeaderboardEntry[] };
    return data.leaderboard;
  }

  async fetchServerStatus(): Promise<ServerOnlineStatus> {
    const res = await fetch(getApiUrl('/api/ranked/status'));
    if (!res.ok) {
      throw new Error(i18n.t('api.err.status', { status: res.status }));
    }
    return (await res.json()) as ServerOnlineStatus;
  }

  async lookupPlayerForFriend(queryId: string): Promise<FriendLookupResponse> {
    if (!this.credentials) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    if (!creds) {
      throw new Error(i18n.t('api.err.noCredentials'));
    }
    const res = await fetch(getApiUrl('/api/friends/lookup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: creds.playerId,
        secretToken: creds.secretToken,
        queryId: queryId.trim(),
      }),
    });
    const data = (await res.json()) as Partial<FriendLookupResponse> & {
      error?: string;
      code?: string;
    };
    if (!res.ok || !data.player || !data.relationStatus) {
      throw new Error(data.error || i18n.t('friends.err.notFound'));
    }
    return {
      player: data.player,
      relationStatus: data.relationStatus,
      pendingRequestId: data.pendingRequestId,
    };
  }

  private firebaseIdToken: string | null = null;

  setFirebaseIdToken(token: string | null): void {
    this.firebaseIdToken = token;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.firebaseIdToken) {
      headers['Authorization'] = `Bearer ${this.firebaseIdToken}`;
    }
    return headers;
  }

  async fetchFriendsState(): Promise<{
    friends: SquadFriendEntry[];
    incomingRequests: FriendRequestEntry[];
    outgoingRequests: OutgoingFriendRequestEntry[];
    outgoingTargetIds: string[];
  }> {
    if (!this.credentials) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    if (!creds) {
      return { friends: [], incomingRequests: [], outgoingRequests: [], outgoingTargetIds: [] };
    }
    const res = await fetch(getApiUrl('/api/friends/state'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        playerId: creds.playerId,
        secretToken: creds.secretToken,
      }),
    });
    if (!res.ok) {
      return { friends: [], incomingRequests: [], outgoingRequests: [], outgoingTargetIds: [] };
    }
    const data = (await res.json()) as {
      friends?: SquadFriendEntry[];
      incomingRequests?: FriendRequestEntry[];
      outgoingRequests?: OutgoingFriendRequestEntry[];
      outgoingTargetIds?: string[];
    };
    return {
      friends: Array.isArray(data.friends) ? data.friends : [],
      incomingRequests: Array.isArray(data.incomingRequests) ? data.incomingRequests : [],
      outgoingRequests: Array.isArray(data.outgoingRequests) ? data.outgoingRequests : [],
      outgoingTargetIds: Array.isArray(data.outgoingTargetIds) ? data.outgoingTargetIds : [],
    };
  }

  async sendFriendRequest(targetId: string): Promise<{
    friends: SquadFriendEntry[];
    incomingRequests: FriendRequestEntry[];
    outgoingRequests: OutgoingFriendRequestEntry[];
    outgoingTargetIds: string[];
  }> {
    if (!this.credentials) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    if (!creds) {
      throw new Error(i18n.t('api.err.noCredentials'));
    }
    const res = await fetch(getApiUrl('/api/friends/request'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        playerId: creds.playerId,
        secretToken: creds.secretToken,
        targetId: targetId.trim(),
      }),
    });
    const data = (await res.json()) as {
      error?: string;
      friends?: SquadFriendEntry[];
      incomingRequests?: FriendRequestEntry[];
      outgoingRequests?: OutgoingFriendRequestEntry[];
      outgoingTargetIds?: string[];
    };
    if (!res.ok) {
      throw new Error(data.error || i18n.t('friends.err.sendFailed'));
    }
    return {
      friends: Array.isArray(data.friends) ? data.friends : [],
      incomingRequests: Array.isArray(data.incomingRequests) ? data.incomingRequests : [],
      outgoingRequests: Array.isArray(data.outgoingRequests) ? data.outgoingRequests : [],
      outgoingTargetIds: Array.isArray(data.outgoingTargetIds) ? data.outgoingTargetIds : [],
    };
  }

  async respondFriendRequest(
    requestId: string,
    accept: boolean,
  ): Promise<{
    accepted: boolean;
    friends: SquadFriendEntry[];
    incomingRequests: FriendRequestEntry[];
    outgoingRequests: OutgoingFriendRequestEntry[];
    outgoingTargetIds: string[];
  }> {
    if (!this.credentials) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    if (!creds) {
      throw new Error(i18n.t('api.err.noCredentials'));
    }
    const res = await fetch(getApiUrl('/api/friends/respond'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        playerId: creds.playerId,
        secretToken: creds.secretToken,
        requestId: requestId.trim(),
        accept,
      }),
    });
    const data = (await res.json()) as {
      accepted?: boolean;
      error?: string;
      friends?: SquadFriendEntry[];
      incomingRequests?: FriendRequestEntry[];
      outgoingRequests?: OutgoingFriendRequestEntry[];
      outgoingTargetIds?: string[];
    };
    if (!res.ok) {
      throw new Error(data.error || i18n.t('friends.err.respondFailed'));
    }
    return {
      accepted: Boolean(data.accepted),
      friends: Array.isArray(data.friends) ? data.friends : [],
      incomingRequests: Array.isArray(data.incomingRequests) ? data.incomingRequests : [],
      outgoingRequests: Array.isArray(data.outgoingRequests) ? data.outgoingRequests : [],
      outgoingTargetIds: Array.isArray(data.outgoingTargetIds) ? data.outgoingTargetIds : [],
    };
  }

  async cancelFriendRequest(requestId: string): Promise<{
    friends: SquadFriendEntry[];
    incomingRequests: FriendRequestEntry[];
    outgoingRequests: OutgoingFriendRequestEntry[];
    outgoingTargetIds: string[];
  }> {
    if (!this.credentials) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    if (!creds) {
      throw new Error(i18n.t('api.err.noCredentials'));
    }
    const res = await fetch(getApiUrl('/api/friends/cancel'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        playerId: creds.playerId,
        secretToken: creds.secretToken,
        requestId: requestId.trim(),
      }),
    });
    const data = (await res.json()) as {
      error?: string;
      friends?: SquadFriendEntry[];
      incomingRequests?: FriendRequestEntry[];
      outgoingRequests?: OutgoingFriendRequestEntry[];
      outgoingTargetIds?: string[];
    };
    if (!res.ok) {
      throw new Error(data.error || i18n.t('friends.err.respondFailed'));
    }
    return {
      friends: Array.isArray(data.friends) ? data.friends : [],
      incomingRequests: Array.isArray(data.incomingRequests) ? data.incomingRequests : [],
      outgoingRequests: Array.isArray(data.outgoingRequests) ? data.outgoingRequests : [],
      outgoingTargetIds: Array.isArray(data.outgoingTargetIds) ? data.outgoingTargetIds : [],
    };
  }

  async removeFriend(friendPlayerId: string): Promise<{
    friends: SquadFriendEntry[];
    incomingRequests: FriendRequestEntry[];
    outgoingRequests: OutgoingFriendRequestEntry[];
    outgoingTargetIds: string[];
  }> {
    if (!this.credentials) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    if (!creds) {
      throw new Error(i18n.t('api.err.noCredentials'));
    }
    const res = await fetch(getApiUrl('/api/friends/remove'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        playerId: creds.playerId,
        secretToken: creds.secretToken,
        friendPlayerId: friendPlayerId.trim(),
      }),
    });
    const data = (await res.json()) as {
      error?: string;
      friends?: SquadFriendEntry[];
      incomingRequests?: FriendRequestEntry[];
      outgoingRequests?: OutgoingFriendRequestEntry[];
      outgoingTargetIds?: string[];
    };
    if (!res.ok) {
      throw new Error(data.error || i18n.t('friends.err.respondFailed'));
    }
    return {
      friends: Array.isArray(data.friends) ? data.friends : [],
      incomingRequests: Array.isArray(data.incomingRequests) ? data.incomingRequests : [],
      outgoingRequests: Array.isArray(data.outgoingRequests) ? data.outgoingRequests : [],
      outgoingTargetIds: Array.isArray(data.outgoingTargetIds) ? data.outgoingTargetIds : [],
    };
  }

  async fetchMailboxState(): Promise<MailboxStateSnapshot> {
    if (!this.credentials && !this.firebaseIdToken) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    const res = await fetch(getApiUrl('/api/mailbox/state'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        playerId: creds?.playerId,
        secretToken: creds?.secretToken,
      }),
    });
    if (!res.ok) {
      return { messages: [], unreadCount: 0, unclaimedRewardCount: 0 };
    }
    const data = (await res.json()) as Partial<MailboxStateSnapshot>;
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      unreadCount: typeof data.unreadCount === 'number' ? data.unreadCount : 0,
      unclaimedRewardCount:
        typeof data.unclaimedRewardCount === 'number' ? data.unclaimedRewardCount : 0,
    };
  }

  async markMailRead(mailId: string): Promise<MailboxStateSnapshot> {
    if (!this.credentials && !this.firebaseIdToken) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    const res = await fetch(getApiUrl('/api/mailbox/read'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        playerId: creds?.playerId,
        secretToken: creds?.secretToken,
        mailId,
      }),
    });
    const data = (await res.json()) as Partial<MailboxStateSnapshot> & { error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'Could not mark mail read.');
    }
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      unreadCount: typeof data.unreadCount === 'number' ? data.unreadCount : 0,
      unclaimedRewardCount:
        typeof data.unclaimedRewardCount === 'number' ? data.unclaimedRewardCount : 0,
    };
  }

  async claimMailReward(mailId: string): Promise<{
    creditsAwarded: number;
    newBalance: number;
    mailbox: MailboxStateSnapshot;
  }> {
    if (!this.credentials && !this.firebaseIdToken) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    const res = await fetch(getApiUrl('/api/mailbox/claim'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        playerId: creds?.playerId,
        secretToken: creds?.secretToken,
        mailId,
      }),
    });
    const data = (await res.json()) as {
      creditsAwarded?: number;
      newBalance?: number;
      mailbox?: MailboxStateSnapshot;
      error?: string;
    };
    if (!res.ok || !data.mailbox) {
      throw new Error(data.error || 'Could not claim reward.');
    }
    return {
      creditsAwarded: typeof data.creditsAwarded === 'number' ? data.creditsAwarded : 0,
      newBalance: typeof data.newBalance === 'number' ? data.newBalance : 0,
      mailbox: data.mailbox,
    };
  }

  async archiveMail(mailId: string, archived: boolean): Promise<MailboxStateSnapshot> {
    if (!this.credentials && !this.firebaseIdToken) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    const res = await fetch(getApiUrl('/api/mailbox/archive'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        playerId: creds?.playerId,
        secretToken: creds?.secretToken,
        mailId,
        archived,
      }),
    });
    const data = (await res.json()) as Partial<MailboxStateSnapshot> & { error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'Could not update archive status.');
    }
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      unreadCount: typeof data.unreadCount === 'number' ? data.unreadCount : 0,
      unclaimedRewardCount:
        typeof data.unclaimedRewardCount === 'number' ? data.unclaimedRewardCount : 0,
    };
  }

  async deleteMail(mailId: string): Promise<MailboxStateSnapshot> {
    if (!this.credentials && !this.firebaseIdToken) {
      await this.ensureProfile();
    }
    const creds = this.credentials;
    const res = await fetch(getApiUrl('/api/mailbox/delete'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        playerId: creds?.playerId,
        secretToken: creds?.secretToken,
        mailId,
      }),
    });
    const data = (await res.json()) as Partial<MailboxStateSnapshot> & { error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'Could not delete mail.');
    }
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      unreadCount: typeof data.unreadCount === 'number' ? data.unreadCount : 0,
      unclaimedRewardCount:
        typeof data.unclaimedRewardCount === 'number' ? data.unclaimedRewardCount : 0,
    };
  }
}
