// bot/utils/cache.js
// In-memory cache for frequently accessed, shared data

class Cache {
    constructor() {
        this.users = new Map(); // discord_id -> user data
        this.companies = new Map(); // company_id -> company data
        this.platforms = new Map(); // platform_id -> platform data
        this.vulnerabilities = new Map(); // vuln_identifier -> vulnerability data

        // TTL settings (in milliseconds)
        this.userTTL = 5 * 60 * 1000; // 5 minutes
        this.sharedDataTTL = 15 * 60 * 1000; // 15 minutes for companies/platforms
        this.vulnTTL = 2 * 60 * 1000; // 2 minutes (changes frequently)
    }

    // User cache
    getUser(discordId) {
        const cached = this.users.get(discordId);
        if (!cached) return null;

        if (Date.now() - cached.timestamp > this.userTTL) {
            this.users.delete(discordId);
            return null;
        }

        return cached.data;
    }

    setUser(discordId, userData) {
        this.users.set(discordId, {
            data: userData,
            timestamp: Date.now()
        });
    }

    invalidateUser(discordId) {
        this.users.delete(discordId);
    }

    // Company cache (shared data - rarely changes)
    getCompany(companyId) {
        const cached = this.companies.get(companyId.toString());
        if (!cached) return null;

        if (Date.now() - cached.timestamp > this.sharedDataTTL) {
            this.companies.delete(companyId.toString());
            return null;
        }

        return cached.data;
    }

    setCompany(companyId, companyData) {
        this.companies.set(companyId.toString(), {
            data: companyData,
            timestamp: Date.now()
        });
    }

    // Platform cache (shared data - rarely changes)
    getPlatform(platformId) {
        const cached = this.platforms.get(platformId.toString());
        if (!cached) return null;

        if (Date.now() - cached.timestamp > this.sharedDataTTL) {
            this.platforms.delete(platformId.toString());
            return null;
        }

        return cached.data;
    }

    setPlatform(platformId, platformData) {
        this.platforms.set(platformId.toString(), {
            data: platformData,
            timestamp: Date.now()
        });
    }

    // Vulnerability cache (changes more frequently)
    getVulnerability(vulnIdentifier) {
        const cached = this.vulnerabilities.get(vulnIdentifier);
        if (!cached) return null;

        if (Date.now() - cached.timestamp > this.vulnTTL) {
            this.vulnerabilities.delete(vulnIdentifier);
            return null;
        }

        return cached.data;
    }

    setVulnerability(vulnIdentifier, vulnData) {
        this.vulnerabilities.set(vulnIdentifier, {
            data: vulnData,
            timestamp: Date.now()
        });
    }

    invalidateVulnerability(vulnIdentifier) {
        this.vulnerabilities.delete(vulnIdentifier);
    }

    // Bulk operations for initialization
    async warmupCompanies(CompanyModel) {
        try {
            const companies = await CompanyModel.find({}).lean();
            companies.forEach(company => {
                this.setCompany(company._id, company);
            });
            console.log(`Cached ${companies.length} companies`);
        } catch (err) {
            console.error('Error warming up company cache:', err);
        }
    }

    async warmupPlatforms(PlatformModel) {
        try {
            const platforms = await PlatformModel.find({}).lean();
            platforms.forEach(platform => {
                this.setPlatform(platform._id, platform);
            });
            console.log(`Cached ${platforms.length} platforms`);
        } catch (err) {
            console.error('Error warming up platform cache:', err);
        }
    }

    // Periodic cleanup of expired entries
    cleanup() {
        const now = Date.now();

        for (const [key, value] of this.users.entries()) {
            if (now - value.timestamp > this.userTTL) {
                this.users.delete(key);
            }
        }

        for (const [key, value] of this.companies.entries()) {
            if (now - value.timestamp > this.sharedDataTTL) {
                this.companies.delete(key);
            }
        }

        for (const [key, value] of this.platforms.entries()) {
            if (now - value.timestamp > this.sharedDataTTL) {
                this.platforms.delete(key);
            }
        }

        for (const [key, value] of this.vulnerabilities.entries()) {
            if (now - value.timestamp > this.vulnTTL) {
                this.vulnerabilities.delete(key);
            }
        }
    }

    // Stats for monitoring
    getStats() {
        return {
            users: this.users.size,
            companies: this.companies.size,
            platforms: this.platforms.size,
            vulnerabilities: this.vulnerabilities.size
        };
    }

    clear() {
        this.users.clear();
        this.companies.clear();
        this.platforms.clear();
        this.vulnerabilities.clear();
    }
}

// Singleton instance
const cache = new Cache();

// Cleanup every 5 minutes
setInterval(() => {
    cache.cleanup();
}, 5 * 60 * 1000);

module.exports = cache;
