const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const Platform = require('../../models/Platform');
const Company = require('../../models/Company');
const Reports = require('../../models/Reports');
const User = require('../../models/Users');
const Vulnerability = require('../../models/Volunerabilies');
const { calculateCVSS } = require('../utils/cvssCalculator');
const generateOffer = require('../utils/generateOffer');
const generateDictatorOffer = require('../utils/generateDicOffer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Submit a vulnerability report to a company'),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {
            const platformRes = await selectPlatform(interaction);
            if (!platformRes) return;

            const companyId = await selectCompany(interaction, platformRes.id);
            if (!companyId) return;

            const vulnerabilityId = await selectOrCreateVulnerability(interaction, companyId);
            if (!vulnerabilityId) return;

            const reportType = await selectReportType(interaction);
            if (!reportType) return;

            let reportData;
            if (reportType === 'full') {
                reportData = await collectFullReport(interaction);
            } else {
                reportData = await collectPOCOnly(interaction);
            }
            if (!reportData) return;

            const platform = await Platform.findById(platformRes.id);
            const company = await Company.findById(companyId);
            const vulnerability = await Vulnerability.findById(vulnerabilityId);

            const submitted = await showSummary(interaction, platform, company, vulnerability, reportData, reportType);
            if (!submitted) return;

            const report = await saveReport(
                interaction,
                platformRes.id,
                companyId,
                vulnerabilityId,
                reportData,
                reportType === 'poc'
            );

            await interaction.followUp({
                content: `**Report Submitted Successfully!**\n\n` +
                    `**Platform:** ${platform.name}\n` +
                    `**Company:** ${company.name}\n` +
                    `**Vulnerability:** ${vulnerability.name}\n` +
                    `**Type:** ${reportType === 'full' ? 'Full Report' : 'POC Only'}\n` +
                    `**Severity:** ${reportData.severity || 'N/A'} ${reportData.cvssScore ? `(CVSS: ${reportData.cvssScore})` : ''}\n` +
                    `**Report ID:** \`${report._id}\``,
                flags: 64,
            });

            // Generate offers for test platforms
            if (reportType === 'full') {
                if (platformRes.name === 'Ultimatum Test Platform') {
                    await generateOffer(interaction.client, report, interaction.user);
                } else if (platformRes.name === 'Dictator Test Platform') {
                    await generateDictatorOffer(interaction.client, report, interaction.user);
                }
            }
        } catch (err) {
            console.error(err);
            await interaction.followUp({
                content: 'An error occurred while submitting your report.',
                flags: 64,
            });
        }
    },
};

async function waitForSelect(message, userId, allowedCustomIds) {
    try {
        const response = await message.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            filter: i => i.user.id === userId && allowedCustomIds.includes(i.customId),
            time: 300_000
        });
        return response;
    } catch (err) {
        return null;
    }
}

async function waitForButton(message, userId, allowedCustomIds) {
    // Convert to array if single string provided
    if (typeof allowedCustomIds === 'string') {
        allowedCustomIds = [allowedCustomIds];
    }

    try {
        const response = await message.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: i => i.user.id === userId && allowedCustomIds.includes(i.customId),
            time: 300_000
        });
        return response;
    } catch (err) {
        return null;
    }
}

async function selectPlatform(interaction) {
    const platforms = await Platform.find({});
    if (!platforms.length) {
        await interaction.editReply('No platforms found in the database.');
        return null;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_platform')
        .setPlaceholder('Select a Platform')
        .addOptions(
            platforms.map(p => ({
                label: p.name,
                description: p.description?.slice(0, 80) || 'No description',
                value: p._id.toString(),
            }))
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: 'Select a Platform to report under:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_platform', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    const selectedId = response.values[0];
    const selectedPlatform = platforms.find((p) => p._id.toString() === selectedId);

    await response.update({ content: 'Platform selected.', components: [] });
    return { id: selectedId, name: selectedPlatform.name };
}

async function selectCompany(interaction, platformId) {
    const companies = await Company.find({ platform_id: platformId });
    if (!companies.length) {
        await interaction.followUp({
            content: 'No companies found for that platform.',
            flags: 64,
        });
        return null;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_company')
        .setPlaceholder('Select a Company')
        .addOptions(
            companies.map(c => ({
                label: c.name,
                description: c.description?.slice(0, 80) || 'No description',
                value: c._id.toString(),
            }))
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: 'Select a Company:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_company', 'back', 'close']);
    if (!response) return null;

    if (response.customId === 'back') {
        await response.update({ content: 'Returning to platform selection...', components: [] });
        const platform = await selectPlatform(interaction);
        return platform ? platform.id : null;
    }

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({ content: 'Company selected.', components: [] });
    return response.values[0];
}

async function selectOrCreateVulnerability(interaction, companyId) {
    const vulnerabilities = await Vulnerability.find({
        company_id: companyId,
        isResolved: false
    }).limit(25);

    const options = vulnerabilities.map(v => ({
        label: v.name || v.vuln_identifier,
        description: `${v.volun_type} - ${v.severity}`,
        value: v._id.toString(),
    }));

    // Add option to report new vulnerability
    options.push({
        label: '🆕 New Vulnerability',
        description: 'Report a new vulnerability',
        value: 'new_vulnerability',
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_vulnerability')
        .setPlaceholder('Select or create a vulnerability')
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: 'Select an existing vulnerability or create a new one:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_vulnerability', 'back', 'close']);
    if (!response) return null;

    if (response.customId === 'back') {
        await response.update({ content: 'Returning to company selection...', components: [] });
        return await selectCompany(interaction, companyId);
    }

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    const selectedValue = response.values[0];

    if (selectedValue === 'new_vulnerability') {
        await response.update({ content: 'Creating new vulnerability...', components: [] });
        return await createNewVulnerability(interaction, companyId);
    }

    await response.update({ content: 'Vulnerability selected.', components: [] });
    return selectedValue;
}

async function createNewVulnerability(interaction, companyId) {
    const modal = new ModalBuilder()
        .setCustomId('new_vuln_modal')
        .setTitle('Create New Vulnerability');

    const identifierInput = new TextInputBuilder()
        .setCustomId('vuln_identifier')
        .setLabel('Vulnerability Identifier')
        .setPlaceholder('e.g., XSS-2024-001')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const nameInput = new TextInputBuilder()
        .setCustomId('vuln_name')
        .setLabel('Vulnerability Name')
        .setPlaceholder('e.g., Stored XSS in Comment Section')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const typeInput = new TextInputBuilder()
        .setCustomId('vuln_type')
        .setLabel('Vulnerability Type')
        .setPlaceholder('XSS, SQLi, CSRF, RCE, IDOR, etc.')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('vuln_description')
        .setLabel('Brief Description')
        .setPlaceholder('Brief description of the vulnerability')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(identifierInput),
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(typeInput),
        new ActionRowBuilder().addComponents(descriptionInput)
    );

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('open_vuln_modal')
            .setLabel('Create Vulnerability')
            .setStyle(ButtonStyle.Primary)
    );

    const message = await interaction.editReply({
        content: 'Click the button below to create a new vulnerability:',
        components: [buttons],
        fetchReply: true
    });

    const buttonResponse = await waitForButton(message, interaction.user.id, 'open_vuln_modal');
    if (!buttonResponse) return null;

    await buttonResponse.showModal(modal);

    const modalResponse = await buttonResponse.awaitModalSubmit({
        time: 300_000,
        filter: i => i.user.id === interaction.user.id
    }).catch(() => null);

    if (!modalResponse) {
        await interaction.editReply({ content: 'Vulnerability creation timed out.', components: [] });
        return null;
    }

    const identifier = modalResponse.fields.getTextInputValue('vuln_identifier');
    const name = modalResponse.fields.getTextInputValue('vuln_name');
    const type = modalResponse.fields.getTextInputValue('vuln_type');
    const description = modalResponse.fields.getTextInputValue('vuln_description');

    // Validate type
    const validTypes = ['XSS', 'SQLi', 'CSRF', 'RCE', 'IDOR', 'Authentication', 'Authorization',
        'Information_Disclosure', 'Business_Logic', 'Cryptographic', 'Other'];

    let vulnType = 'Other';
    const inputType = type.trim().toLowerCase();
    const foundType = validTypes.find(t => t.toLowerCase() === inputType);
    if (foundType) {
        vulnType = foundType;
    }
    const vulnerability = await Vulnerability.create({
        company_id: companyId,
        vuln_identifier: identifier,
        name: name,
        volun_type: vulnType,
        description: description || 'No description provided',
        severity: 'Medium',
        isReported: false,
        isResolved: false
    });

    await modalResponse.update({
        content: `Vulnerability created: **${name}**`,
        components: []
    });

    return vulnerability._id.toString();
}

async function selectReportType(interaction) {
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('full_report')
            .setLabel('Full Report')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📋'),
        new ButtonBuilder()
            .setCustomId('poc_only')
            .setLabel('POC Only')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔬'),
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: '**Select Report Type:**\n\n' +
            '📋 **Full Report** - Complete vulnerability report with impact analysis\n' +
            '🔬 **POC Only** - Just proof-of-concept for an existing vulnerability',
        components: [buttons],
        fetchReply: true
    });

    const response = await waitForButton(message, interaction.user.id, ['full_report', 'poc_only', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({
        content: `Report type selected: **${response.customId === 'full_report' ? 'Full Report' : 'POC Only'}**`,
        components: []
    });

    return response.customId === 'full_report' ? 'full' : 'poc';
}

async function collectFullReport(interaction) {
    // First, collect CVSS vector
    const cvssData = await collectCVSSData(interaction);
    if (!cvssData) return null;

    // Then collect report details
    const modal = new ModalBuilder()
        .setCustomId('full_report_modal')
        .setTitle('Full Vulnerability Report');

    const titleInput = new TextInputBuilder()
        .setCustomId('report_title')
        .setLabel('Report Title')
        .setPlaceholder('Brief, descriptive title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Vulnerability Description')
        .setPlaceholder('Detailed description of the vulnerability')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const impactInput = new TextInputBuilder()
        .setCustomId('impact')
        .setLabel('Impact')
        .setPlaceholder('What is the potential impact?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const pocInput = new TextInputBuilder()
        .setCustomId('poc_steps')
        .setLabel('Proof of Concept Steps')
        .setPlaceholder('Step 1: ...\nStep 2: ...\nStep 3: ...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(impactInput),
        new ActionRowBuilder().addComponents(pocInput)
    );

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('open_report_modal')
            .setLabel('Fill Report Details')
            .setStyle(ButtonStyle.Primary)
    );

    const message = await interaction.editReply({
        content: `**CVSS Score Calculated:** ${cvssData.score} (${cvssData.severity})\n\nClick the button below to fill out your report:`,
        components: [buttons],
        fetchReply: true
    });

    const buttonResponse = await waitForButton(message, interaction.user.id, 'open_report_modal');
    if (!buttonResponse) return null;

    await buttonResponse.showModal(modal);

    const modalResponse = await buttonResponse.awaitModalSubmit({
        time: 600_000,
        filter: i => i.user.id === interaction.user.id
    }).catch(() => null);

    if (!modalResponse) {
        await interaction.editReply({ content: 'Report submission timed out.', components: [] });
        return null;
    }

    const title = modalResponse.fields.getTextInputValue('report_title');
    const description = modalResponse.fields.getTextInputValue('description');
    const impact = modalResponse.fields.getTextInputValue('impact');
    const pocSteps = modalResponse.fields.getTextInputValue('poc_steps');

    await modalResponse.update({
        content: 'Report details collected. Preparing summary...',
        components: []
    });

    return {
        title,
        severity: cvssData.severity,
        cvssScore: cvssData.score,
        cvssVector: cvssData.vector,
        description,
        impact,
        pocSteps: pocSteps.split('\n').filter(s => s.trim())
    };
}

async function collectCVSSData(interaction) {
    const cvssMetrics = {
        attackVector: null,
        attackComplexity: null,
        privilegesRequired: null,
        userInteraction: null,
        scope: null,
        confidentiality: null,
        integrity: null,
        availability: null
    };

    // Attack Vector
    const av = await askCVSSMetric(interaction, 'Attack Vector', [
        { label: 'Network (N)', value: 'N', description: 'Remotely exploitable' },
        { label: 'Adjacent (A)', value: 'A', description: 'Adjacent network access' },
        { label: 'Local (L)', value: 'L', description: 'Local access required' },
        { label: 'Physical (P)', value: 'P', description: 'Physical access required' }
    ]);
    if (!av) return null;
    cvssMetrics.attackVector = av;

    // Attack Complexity
    const ac = await askCVSSMetric(interaction, 'Attack Complexity', [
        { label: 'Low (L)', value: 'L', description: 'No special conditions' },
        { label: 'High (H)', value: 'H', description: 'Special conditions required' }
    ]);
    if (!ac) return null;
    cvssMetrics.attackComplexity = ac;

    // Privileges Required
    const pr = await askCVSSMetric(interaction, 'Privileges Required', [
        { label: 'None (N)', value: 'N', description: 'No privileges needed' },
        { label: 'Low (L)', value: 'L', description: 'Basic user privileges' },
        { label: 'High (H)', value: 'H', description: 'Admin privileges required' }
    ]);
    if (!pr) return null;
    cvssMetrics.privilegesRequired = pr;

    // User Interaction
    const ui = await askCVSSMetric(interaction, 'User Interaction', [
        { label: 'None (N)', value: 'N', description: 'No user interaction' },
        { label: 'Required (R)', value: 'R', description: 'User must take action' }
    ]);
    if (!ui) return null;
    cvssMetrics.userInteraction = ui;

    // Scope
    const s = await askCVSSMetric(interaction, 'Scope', [
        { label: 'Unchanged (U)', value: 'U', description: 'Same security authority' },
        { label: 'Changed (C)', value: 'C', description: 'Different security authority' }
    ]);
    if (!s) return null;
    cvssMetrics.scope = s;

    // Confidentiality Impact
    const c = await askCVSSMetric(interaction, 'Confidentiality Impact', [
        { label: 'None (N)', value: 'N', description: 'No information disclosure' },
        { label: 'Low (L)', value: 'L', description: 'Some information disclosed' },
        { label: 'High (H)', value: 'H', description: 'Total information disclosure' }
    ]);
    if (!c) return null;
    cvssMetrics.confidentiality = c;

    // Integrity Impact
    const i = await askCVSSMetric(interaction, 'Integrity Impact', [
        { label: 'None (N)', value: 'N', description: 'No modification possible' },
        { label: 'Low (L)', value: 'L', description: 'Limited modification' },
        { label: 'High (H)', value: 'H', description: 'Total data modification' }
    ]);
    if (!i) return null;
    cvssMetrics.integrity = i;

    // Availability Impact
    const a = await askCVSSMetric(interaction, 'Availability Impact', [
        { label: 'None (N)', value: 'N', description: 'No availability impact' },
        { label: 'Low (L)', value: 'L', description: 'Reduced performance' },
        { label: 'High (H)', value: 'H', description: 'Total availability loss' }
    ]);
    if (!a) return null;
    cvssMetrics.availability = a;

    // Calculate CVSS score
    const result = calculateCVSS(cvssMetrics);

    return result;
}

async function askCVSSMetric(interaction, metricName, options) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('cvss_metric')
        .setPlaceholder(`Select ${metricName}`)
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: `**CVSS v3.1 Calculator**\n\n**${metricName}:**\nSelect the appropriate value:`,
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['cvss_metric', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({ content: `${metricName} selected.`, components: [] });
    return response.values[0];
}

async function collectPOCOnly(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('poc_only_modal')
        .setTitle('POC Submission');

    const pocInput = new TextInputBuilder()
        .setCustomId('poc_steps')
        .setLabel('Proof of Concept Steps')
        .setPlaceholder('Step 1: Navigate to...\nStep 2: Enter payload...\nStep 3: Observe...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Additional Notes (Optional)')
        .setPlaceholder('Any additional observations or notes')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(pocInput),
        new ActionRowBuilder().addComponents(notesInput)
    );

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('open_poc_modal')
            .setLabel('Submit POC')
            .setStyle(ButtonStyle.Primary)
    );

    const message = await interaction.editReply({
        content: 'Click the button below to submit your POC:',
        components: [buttons],
        fetchReply: true
    });

    const buttonResponse = await waitForButton(message, interaction.user.id, 'open_poc_modal');
    if (!buttonResponse) return null;

    await buttonResponse.showModal(modal);

    const modalResponse = await buttonResponse.awaitModalSubmit({
        time: 300_000,
        filter: i => i.user.id === interaction.user.id
    }).catch(() => null);

    if (!modalResponse) {
        await interaction.editReply({ content: 'POC submission timed out.', components: [] });
        return null;
    }

    const pocSteps = modalResponse.fields.getTextInputValue('poc_steps');
    const notes = modalResponse.fields.getTextInputValue('notes');

    await modalResponse.update({
        content: 'POC details collected. Preparing summary...',
        components: []
    });

    return {
        pocSteps: pocSteps.split('\n').filter(s => s.trim()),
        notes: notes || 'No additional notes'
    };
}

async function showSummary(interaction, platform, company, vulnerability, reportData, reportType) {
    let summaryContent;

    if (reportType === 'full') {
        summaryContent = `
**Full Report Summary**

**Platform:** ${platform.name}
**Company:** ${company.name}
**Vulnerability:** ${vulnerability.name}

**Title:** ${reportData.title}
**Severity:** ${reportData.severity} (CVSS: ${reportData.cvssScore})
**CVSS Vector:** ${reportData.cvssVector}

**Description:**
${reportData.description.slice(0, 500)}${reportData.description.length > 500 ? '...' : ''}

**Impact:**
${reportData.impact.slice(0, 500)}${reportData.impact.length > 500 ? '...' : ''}

**POC Steps:**
${reportData.pocSteps.slice(0, 5).map((step, i) => `${i + 1}. ${step}`).join('\n')}

Review and click **Submit** to finalize.
        `.trim();
    } else {
        summaryContent = `
**POC Submission Summary**

**Platform:** ${platform.name}
**Company:** ${company.name}
**Vulnerability:** ${vulnerability.name}

**POC Steps:**
${reportData.pocSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

**Notes:**
${reportData.notes}

Review and click **Submit** to finalize.
        `.trim();
    }

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('submit')
            .setLabel('Submit Report')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: summaryContent,
        components: [buttons],
        fetchReply: true
    });

    const response = await waitForButton(message, interaction.user.id, ['submit', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({
        content: 'Submitting your report...',
        components: []
    });
    return true;
}

async function saveReport(interaction, platformId, companyId, vulnerabilityId, reportData, isPOCOnly) {
    const discordId = interaction.user.id;
    const discordName = interaction.user.username;

    let user = await User.findOne({ discord_id: discordId });
    if (!user) {
        user = await User.create({
            discord_id: discordId,
            username: discordName,
            reports_made: 0
        });
    }

    await User.updateOne(
        { _id: user._id },
        { $inc: { reports_made: 1 } }
    );

    const reportDoc = {
        user_id: user._id,
        platform_id: platformId,
        company_id: companyId,
        vulnerability_id: vulnerabilityId,
        is_poc_only: isPOCOnly,
        status: isPOCOnly ? 'poc_submitted' : 'open'
    };

    if (isPOCOnly) {
        reportDoc.poc_steps = reportData.pocSteps;
        reportDoc.report_description = reportData.notes;
        reportDoc.volunerablity_sev = 'None';
    } else {
        reportDoc.report_title = reportData.title;
        reportDoc.volunerablity_sev = reportData.severity;
        reportDoc.cvss_score = reportData.cvssScore;
        reportDoc.cvss_vector = reportData.cvssVector;
        reportDoc.report_description = reportData.description;
        reportDoc.impact_description = reportData.impact;
        reportDoc.poc_steps = reportData.pocSteps;
    }

    const report = await Reports.create(reportDoc);

    if (isPOCOnly) {
        await Vulnerability.updateOne(
            { _id: vulnerabilityId },
            {
                $push: {
                    pocs_submitted: {
                        user_id: user._id,
                        submitted_at: new Date(),
                        poc_data: {
                            steps: reportData.pocSteps,
                            notes: reportData.notes
                        }
                    }
                }
            }
        );
    } else {
        await Vulnerability.updateOne(
            { _id: vulnerabilityId },
            {
                $set: {
                    severity: reportData.severity,
                    cvss_score: reportData.cvssScore,
                    cvss_vector: reportData.cvssVector,
                    isReported: true,
                    reported_date: new Date()
                },
                $push: {
                    reported_by: {
                        user_id: user._id,
                        reported_at: new Date(),
                        report_id: report._id
                    }
                },
                $setOnInsert: {
                    first_reporter: user._id,
                    first_reported_at: new Date()
                }
            },
            { upsert: false }
        );
    }

    return report;
}

