const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Question 1
const argv = require('process').argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const val = argv[i+1] && !argv[i+1].startsWith('--') ? argv[i+1] : true;
    args[key] = val;
  }
}

const MONGO_URI = args.mongoUri || process.env.MONGO_URI || 'mongodb://localhost:27017/thesisbot';
const OUT_DIR = args.outDir || path.join(__dirname, 'output');
const ROUND_ID = args.roundId || null;

async function main(){
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  const Report = require('../models/Reports');
  const Exploit = require('../models/Exploit');
  const Vulnerability = require('../models/Vulnerabilities');
  const CompanyOffer = require('../models/CompanyOffers');
  const User = require('../models/Users');

  // 1) Reporting rate per player
  const reportingRatePipeline = [
    { $lookup: { from: 'reports', localField: '_id', foreignField: 'user_id', as: 'reports' } },
    { $lookup: {
        from: 'vulnerabilities',
        let: { uid: '$_id' },
        pipeline: [
          { $unwind: { path: '$discovered_by', preserveNullAndEmptyArrays: true } },
          { $match: { $expr: { $eq: ['$discovered_by.user_id', '$$uid'] } } },
          { $group: { _id: null, discoveries: { $sum: 1 } } }
        ],
        as: 'discoveriesAgg'
    }},
    { $addFields: {
        reports_count: { $size: '$reports' },
        discoveries_count: { $ifNull: [{ $arrayElemAt: ['$discoveriesAgg.discoveries', 0] }, 0] }
    }},
    { $project: {
        discord_id:1, discord_name:1, reports_count:1, discoveries_count:1,
        reporting_rate: {
          $cond: [ { $gt: ['$discoveries_count', 0] }, { $divide: ['$reports_count', '$discoveries_count'] }, null ]
        }
    }}
  ];

  // 2) Exploit usage rate per player
  const exploitUsagePipeline = [
    { $group: { _id: '$user_id', exploit_count: { $sum: 1 }, total_cycles: { $sum: '$cycles_completed' } } },
    { $project: { user_id: '$_id', exploit_count:1, total_cycles:1, _id:0 } }
  ];

  // 3) Average reward accepted per user
  const avgAcceptedPipeline = [
    { $match: { status: 'accepted', offered_amount: { $gt: 0 } } },
    { $group: { _id: '$user_id', avg_accepted: { $avg: '$offered_amount' }, total_accepted: { $sum: '$offered_amount' }, count: { $sum: 1 } } },
    { $project: { user_id: '$_id', avg_accepted:1, total_accepted:1, count:1, _id:0 } }
  ];

  // 4) Time between discovering vulnerability and reporting it
  const timeToReportPipeline = [
    { $lookup: { from: 'vulnerabilities', localField: 'vulnerability_id', foreignField: '_id', as: 'vuln' } },
    { $unwind: '$vuln' },
    { $addFields: {
        discovered_entry: {
          $arrayElemAt: [
            { $filter: { input: '$vuln.discovered_by', as: 'd', cond: { $eq: ['$$d.user_id', '$user_id'] } } }, 0
          ]
        }
    }},
    { $project: {
        user_id:1, vulnerability_id:1, submitted_at:1,
        discovered_at: '$discovered_entry.discovered_at',
        delta_ms: { $cond: [ { $and: ['$discovered_entry.discovered_at', '$submitted_at'] }, { $subtract: ['$submitted_at', '$discovered_entry.discovered_at'] }, null ] }
    }},
    { $addFields: { delta_hours: { $cond: [ { $ifNull: ['$delta_ms', false] }, { $divide: ['$delta_ms', 1000*60*60] }, null ] } } }
  ];

  // 5) Avg player profit over time (estimate: accepted offers + exploit earnings - penalties)

  const profitPipeline = [
    { $lookup: {
        from: 'company_offers', let: { uid: '$_id' }, pipeline: [
          { $match: { $expr: { $and: [ { $eq: ['$user_id', '$$uid'] }, { $eq: ['$status', 'accepted'] } ] } } },
          { $group: { _id: null, offers_sum: { $sum: '$offered_amount' } } }
        ], as: 'offersAgg'
    }},
    { $lookup: {
        from: 'exploits', let: { uid: '$_id' }, pipeline: [
          { $match: { $expr: { $eq: ['$user_id', '$$uid'] } } },
          { $group: { _id: null, exploit_sum: { $sum: { $multiply: ['$money_per_cycle', '$cycles_completed'] } } } }
        ], as: 'exploitsAgg'
    }},
    { $addFields: {
        offers_sum: { $ifNull: [{ $arrayElemAt: ['$offersAgg.offers_sum', 0] }, 0] },
        exploit_sum_est: { $ifNull: [{ $arrayElemAt: ['$exploitsAgg.exploit_sum', 0] }, 0] },
        penalties_sum: { $sum: { $map: { input: '$penalties', as: 'p', in: '$$p.amount' } } }
    }},
    { $project: { discord_id:1, discord_name:1, offers_sum:1, exploit_sum_est:1, penalties_sum:1, estimated_net: { $subtract: [ { $add: ['$offers_sum', '$exploit_sum_est'] }, '$penalties_sum' ] } } }
  ];

  // 6) Report-to-Exploit ratio per player per company


  try{
    const [reportingRate, exploitUsage, avgAccepted, timeToReport, profitByUser, exploitsByUserCompany] = await Promise.all([
      User.aggregate(reportingRatePipeline).allowDiskUse(true),
      Exploit.aggregate(exploitUsagePipeline).allowDiskUse(true),
      CompanyOffer.aggregate(avgAcceptedPipeline).allowDiskUse(true),
      Report.aggregate(timeToReportPipeline).allowDiskUse(true),
      User.aggregate(profitPipeline).allowDiskUse(true),
      Exploit.aggregate([
        { $lookup: { from: 'vulnerabilities', localField: 'volunerability_id', foreignField: '_id', as: 'vuln'} },
        { $unwind: '$vuln' },
        { $group: { _id: { user: '$user_id', company: '$vuln.company_id' }, exploit_count: { $sum: 1 } } },
        { $project: { user: '$_id.user', company: '$_id.company', exploit_count:1, _id:0 } }
      ]).allowDiskUse(true)
    ]);

    // Reports by user-company
    const reportsByUserCompany = await Report.aggregate([
      { $group: { _id: { user: '$user_id', company: '$company_id' }, reports_count: { $sum: 1 } } },
      { $project: { user: '$_id.user', company: '$_id.company', reports_count:1, _id:0 } }
    ]).allowDiskUse(true);

    // Merge report/exploit matrices into ratios
    const ratioMap = new Map();
    reportsByUserCompany.forEach(r => {
      const key = `${r.user}_${r.company}`;
      ratioMap.set(key, { user: r.user, company: r.company, reports_count: r.reports_count, exploit_count: 0 });
    });
    exploitsByUserCompany.forEach(e => {
      const key = `${e.user}_${e.company}`;
      if (ratioMap.has(key)) ratioMap.get(key).exploit_count = e.exploit_count;
      else ratioMap.set(key, { user: e.user, company: e.company, reports_count: 0, exploit_count: e.exploit_count });
    });

    const reportExploitRatio = Array.from(ratioMap.values()).map(x => ({ ...x, report_to_exploit: x.exploit_count ? x.reports_count / x.exploit_count : (x.reports_count ? Infinity : 0) }));

    // Write outputs
    const outputs = {
      'reporting_rate_per_player.json': reportingRate,
      'exploit_usage_per_player.json': exploitUsage,
      'avg_accepted_reward_per_user.json': avgAccepted,
      'time_to_report_per_report.json': timeToReport,
      'avg_player_profit_estimate.json': profitByUser,
      'report_exploit_ratio_per_user_company.json': reportExploitRatio
    };

    for (const [fname, data] of Object.entries(outputs)){
      const outPath = path.join(OUT_DIR, fname);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log('Wrote', outPath);
    }

  } catch (err){
    console.error('Aggregation error', err);
  } finally{
    await mongoose.disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
