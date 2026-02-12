

class Cache {
    constructor() {
        this.companies = new Map(); // company_id -> company data
        this.platforms = new Map(); // platform_id -> platform data


        // TTL settings (in milliseconds)
        this.userTTL = 5 * 60 * 1000; // 5 minutes
        this.sharedDataTTL = 15 * 60 * 1000; // 15 minutes for companies/platforms
        this.vulnTTL = 2 * 60 * 1000; // 2 minutes (changes frequently)
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


    }

    // Stats for monitoring
    getStats() {
        return {
            companies: this.companies.size,
            platforms: this.platforms.size,
        };
    }

    clear() {

        this.companies.clear();
        this.platforms.clear();

    }
}

// Singleton instance
const cache = new Cache();

// Cleanup every 5 minutes
setInterval(() => {
    cache.cleanup();
}, 5 * 60 * 1000);

module.exports = cache;
