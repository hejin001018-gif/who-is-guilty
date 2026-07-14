import { z } from "zod";

export const MAX_TURNS = 20;
export const MAX_SEARCHES = 4;
export const PROTECTED_ACTION_LIMIT = 5;

export const CASE_BACKGROUND_OPTIONS = {
  settingType: ["居住社区", "医疗机构", "教育场所", "文化场馆", "交通物流", "科研设施", "公共服务", "体育场所", "商业设施", "户外设施"],
  incidentType: ["物品失窃", "关键调包", "数据篡改", "身份冒用", "蓄意破坏", "秘密泄露", "栽赃陷害", "记录伪造"],
  motiveType: ["经济利益", "掩盖过失", "保护声誉", "关系报复", "争夺成果", "逃避责任", "隐瞒身份", "阻止揭露"],
  methodType: ["权限空窗", "路线误导", "时间错位", "替身物品", "身份伪装", "记录覆盖", "关系互保", "远程操控"]
};

const subjectIdSchema = z.enum(["ai1", "ai2", "ai3"]);
const text = (max) => z.string().trim().min(1).max(max);

const subjectSchema = z.object({
  id: subjectIdSchema,
  slot: z.number().int().min(0).max(2),
  name: text(30),
  aiName: text(40),
  age: z.number().int().min(12).max(110),
  tag: text(40),
  publicRole: text(240),
  secretRole: text(320),
  relationship: text(320),
  guilty: z.boolean(),
  keywords: z.array(text(30)).min(1).max(12),
  pressure: z.number().min(0).max(100),
  opening: text(320),
  protectLine: text(320),
  selfSaveLine: text(320),
  revealLine: text(320)
});

const evidenceSchema = z.object({
  id: text(80),
  type: text(40),
  title: text(100),
  detail: text(500),
  revealed: z.boolean(),
  target: subjectIdSchema.nullable(),
  strength: z.enum(["soft", "strong", "exonerating"]),
  logic: z.string().trim().max(500).default(""),
  misleading: z.boolean().default(false),
  truthExplanation: z.string().trim().max(500).default("")
});

const caseReportSchema = z.object({
  motive: text(700),
  method: text(1000),
  timeline: z.array(z.object({
    time: text(40),
    event: text(400)
  })).min(3).max(10),
  roles: z.array(z.object({
    subjectId: subjectIdSchema,
    involvement: text(500)
  })).length(3),
  evidenceChain: z.array(text(500)).min(4).max(12),
  misdirections: z.array(text(500)).min(2).max(8)
});

const caseBackgroundSchema = z.object({
  settingType: z.enum(CASE_BACKGROUND_OPTIONS.settingType),
  incidentType: z.enum(CASE_BACKGROUND_OPTIONS.incidentType),
  motiveType: z.enum(CASE_BACKGROUND_OPTIONS.motiveType),
  methodType: z.enum(CASE_BACKGROUND_OPTIONS.methodType)
});

const caseFileSchema = z.object({
  title: text(100),
  publicBrief: text(600),
  hiddenTruth: text(1000),
  background: caseBackgroundSchema,
  caseReport: caseReportSchema,
  guiltyIds: z.array(subjectIdSchema).min(1).max(3),
  subjects: z.array(subjectSchema).length(3),
  evidence: z.array(evidenceSchema).min(12).max(30)
}).superRefine((caseFile, ctx) => {
  const subjectIds = caseFile.subjects.map((subject) => subject.id);
  const expectedIds = ["ai1", "ai2", "ai3"];
  if (new Set(subjectIds).size !== 3 || !expectedIds.every((id) => subjectIds.includes(id))) {
    ctx.addIssue({ code: "custom", path: ["subjects"], message: "subjects must contain unique ai1, ai2 and ai3 entries" });
  }

  const slotById = Object.fromEntries(caseFile.subjects.map((subject) => [subject.id, subject.slot]));
  if (slotById.ai1 !== 0 || slotById.ai2 !== 1 || slotById.ai3 !== 2) {
    ctx.addIssue({ code: "custom", path: ["subjects"], message: "subject slots must match their ids" });
  }

  const guiltyFromSubjects = caseFile.subjects.filter((subject) => subject.guilty).map((subject) => subject.id).sort();
  const declaredGuilty = [...new Set(caseFile.guiltyIds)].sort();
  if (JSON.stringify(guiltyFromSubjects) !== JSON.stringify(declaredGuilty)) {
    ctx.addIssue({ code: "custom", path: ["guiltyIds"], message: "guiltyIds must match subjects[].guilty" });
  }

  const evidenceIds = caseFile.evidence.map((item) => item.id);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    ctx.addIssue({ code: "custom", path: ["evidence"], message: "evidence ids must be unique" });
  }

  if (caseFile.evidence.filter((item) => item.revealed).length !== 4) {
    ctx.addIssue({ code: "custom", path: ["evidence"], message: "exactly four evidence items must be revealed initially" });
  }

  if (!caseFile.evidence.some((item) => !item.revealed && item.target === null)) {
    ctx.addIssue({ code: "custom", path: ["evidence"], message: "at least one hidden connective evidence item must target null" });
  }

  const misleadingEvidence = caseFile.evidence.filter((item) => item.misleading);
  if (misleadingEvidence.length < 2 || !misleadingEvidence.some((item) => item.revealed)) {
    ctx.addIssue({
      code: "custom",
      path: ["evidence"],
      message: "at least two evidence items must be factually true but misleading, including one initially revealed item"
    });
  }
  misleadingEvidence.forEach((item) => {
    if (!item.truthExplanation) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: `misleading evidence ${item.id} needs a truthExplanation` });
    }
  });

  const reportRoleIds = caseFile.caseReport.roles.map((item) => item.subjectId).sort();
  if (JSON.stringify(reportRoleIds) !== JSON.stringify(expectedIds)) {
    ctx.addIssue({ code: "custom", path: ["caseReport", "roles"], message: "case report must explain all three subjects exactly once" });
  }

  caseFile.subjects.forEach((subject, index) => {
    const resolutionStrength = subject.guilty ? "strong" : "exonerating";
    const hasResolutionEvidence = caseFile.evidence.some((item) => (
      !item.revealed && item.target === subject.id && item.strength === resolutionStrength
    ));
    if (!hasResolutionEvidence) {
      ctx.addIssue({
        code: "custom",
        path: ["subjects", index],
        message: `missing hidden ${resolutionStrength} evidence for ${subject.id}`
      });
    }
  });
});

export function parseCaseFile(value) {
  const result = caseFileSchema.safeParse(value);
  if (!result.success) {
    const summary = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid generated case: ${summary}`);
  }
  return enrichCaseFile(result.data);
}

export function enrichCaseFile(caseFile) {
  return {
    ...caseFile,
    subjects: caseFile.subjects.map((subject) => ({
      ...subject,
      protected: isProtectedAge(subject.age),
      limit: isProtectedAge(subject.age) ? PROTECTED_ACTION_LIMIT : null
    }))
  };
}

export function hasDistinctCaseBackground(candidate, previousCases = []) {
  const candidateBackground = candidate?.background || candidate;
  if (!candidateBackground) return false;
  return previousCases.filter(Boolean).every((previousCase) => {
    const previousBackground = previousCase?.background || previousCase;
    if (!previousBackground) return true;
    if (candidateBackground.settingType === previousBackground.settingType) return false;
    if (candidateBackground.incidentType === previousBackground.incidentType) return false;
    const sameMotive = candidateBackground.motiveType === previousBackground.motiveType;
    const sameMethod = candidateBackground.methodType === previousBackground.methodType;
    return !(sameMotive && sameMethod);
  });
}

export function createPublicCaseFile(caseFile, revealedEvidenceIds) {
  return {
    title: caseFile.title,
    publicBrief: caseFile.publicBrief,
    subjects: caseFile.subjects.map((subject) => ({
      id: subject.id,
      slot: subject.slot,
      name: subject.name,
      aiName: subject.aiName,
      age: subject.age,
      tag: subject.tag,
      publicRole: subject.publicRole,
      relationship: subject.relationship,
      opening: subject.opening,
      protected: subject.protected,
      limit: subject.limit
    })),
    evidence: caseFile.evidence
      .filter((item) => revealedEvidenceIds.has(item.id))
      .map(publicEvidence)
  };
}

export function publicEvidence(item) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    detail: item.detail
  };
}

export function buildSearchQueue(caseFile) {
  const chosen = [];
  caseFile.subjects.forEach((subject) => {
    const resolutionStrength = subject.guilty ? "strong" : "exonerating";
    const candidates = caseFile.evidence.filter((item) => (
      !item.revealed && item.target === subject.id && item.strength === resolutionStrength
    ));
    const selected = pick(candidates);
    if (selected) chosen.push(selected.id);
  });

  const connective = caseFile.evidence.filter((item) => !item.revealed && item.target === null && !chosen.includes(item.id));
  const remaining = caseFile.evidence.filter((item) => !item.revealed && !chosen.includes(item.id));
  const fourth = pick(connective) || pick(remaining);
  if (fourth) chosen.push(fourth.id);
  return shuffle(chosen).slice(0, MAX_SEARCHES);
}

export function chooseSearchEvidence(caseState, subjectId) {
  const available = caseState.searchQueue
    .map((id) => caseState.caseFile.evidence.find((item) => item.id === id))
    .filter((item) => item && !caseState.revealedEvidence.has(item.id));
  return available.find((item) => item.target === subjectId)
    || available.find((item) => item.target === null)
    || available[0]
    || null;
}

export function createLocalReply(subject, question, revealedEvidence, pressure) {
  const subjectEvidence = revealedEvidence.filter((item) => item.target === subject.id);
  const decisive = subjectEvidence.some((item) => item.strength === "strong" || item.strength === "exonerating");
  const pressureHigh = pressure >= 45;
  const asksGang = includesAny(question, ["团伙", "同伙", "一起", "谁指使", "谁让你", "保护", "关系"]);
  const asksSelf = includesAny(question, subject.keywords);

  if (!subject.guilty) {
    if (decisive || pressureHigh) {
      return `${subject.selfSaveLine} 我能确认的是：我看到过可疑动线，但我没有接触核心物品。`;
    }
    return `${subject.protectLine} 我不想误伤别人，也不想把记不清的细节说成事实。`;
  }
  if (decisive && pressureHigh) return subject.selfSaveLine;
  if (decisive && asksSelf) return `这些证据对我不利，但还不能说明完整经过。${subject.selfSaveLine}`;
  if (asksGang) return subject.protectLine;
  if (subjectEvidence.length > 0) {
    return `我知道你们手里有${subjectEvidence.map((item) => `《${item.title}》`).join("、")}。但证据只说明我接近过相关区域，不能证明我是核心责任人。`;
  }
  return subject.opening;
}

export function createInterrogationVisual(subject, question, revealedEvidence, pressure) {
  const expressionSeed = [...`${subject.id}:${question}:${Math.round(pressure / 10)}`]
    .reduce((total, character) => total + character.charCodeAt(0), 0);
  const deceptiveExpressions = ["calm", "uneasy", "defiant", "hesitant", "fatigued", "unreadable"];
  const mood = deceptiveExpressions[expressionSeed % deceptiveExpressions.length];
  const captions = {
    calm: "人物神情显得平静；这种平静可能自然，也可能是刻意维持。",
    uneasy: "人物出现轻微紧张反应；无辜者与有罪者都可能因审讯产生紧张。",
    defiant: "人物表情较为强硬；态度不能替代证据。",
    hesitant: "人物回答前出现短暂停顿；停顿原因无法仅凭画面确定。",
    fatigued: "人物显得疲惫；疲惫状态不代表证词真伪。",
    unreadable: "人物表情难以辨认，可能真实，也可能经过刻意控制。"
  };
  return {
    mood,
    intensity: 34 + (expressionSeed % 43),
    symbols: ["REC", "LIVE", `CAM-${subject.slot + 1}`],
    caption: captions[mood]
  };
}

export function createLocalCaseFile(previousCases = []) {
  const scenarios = [
    { title: "蓝箱失窃案", object: "存有公益资金审计资料的蓝色密封箱", location: "社区机房", time: "20:30 到 20:50", decoy: "维修灯", marker: "绿灯", action: "取走箱内审计硬盘", motive: "阻止一份公益资金异常记录被公开", method: "借临时维修权限制造门禁空窗，取走硬盘后把空箱放回原位。", background: { settingType: "居住社区", incidentType: "物品失窃", motiveType: "阻止揭露", methodType: "权限空窗" }, publicBrief: "一只蓝色密封箱在社区机房短暂失踪，半小时后又被放回，但内部硬盘不翼而飞。" },
    { title: "雨夜药柜调包案", object: "街区诊所冷藏药柜里的试剂盒", location: "诊所后廊", time: "19:40 到 20:05", decoy: "漏水警报", marker: "红色保温袋", action: "以过期试剂替换合格批次", motive: "通过替换合格试剂转卖牟利", method: "利用暴雨造成的时间记录偏差，把两批外观相同的试剂在冷藏转运途中交换。", background: { settingType: "医疗机构", incidentType: "关键调包", motiveType: "经济利益", methodType: "时间错位" }, publicBrief: "暴雨期间诊所后廊断电 12 分钟，一组试剂盒被调包，现场留下互相矛盾的证词。" },
    { title: "银牌档案伪造案", object: "地方纪念馆银牌的来源档案与实物", location: "纪念馆修复室", time: "18:20 到 18:45", decoy: "讲解器故障", marker: "蓝色绒布袋", action: "用复制品配合伪造档案掩盖真品去向", motive: "掩盖早前错误鉴定造成的声誉危机", method: "提前制作替身物品，再借闭馆盘点同时替换展品和来源页。", background: { settingType: "文化场馆", incidentType: "记录伪造", motiveType: "保护声誉", methodType: "替身物品" }, publicBrief: "闭馆盘点发现纪念银牌与来源档案彼此矛盾：实物像真品，登记页却出现了不可能的修订时间。" },
    { title: "潮位日志改写案", object: "河道泵站的离线潮位记录盘", location: "防汛调度站", time: "21:10 到 21:32", decoy: "传感器校准", marker: "黄色防水盒", action: "覆盖故障发生前后的原始潮位数据", motive: "掩盖未按规程巡检造成的严重过失", method: "先远程制造传感器离线假象，再在本地记录恢复前覆盖原始数据。", background: { settingType: "公共服务", incidentType: "数据篡改", motiveType: "掩盖过失", methodType: "远程操控" }, publicBrief: "河道水位异常后，调度站的云端曲线与离线记录盘相互冲突，三名当值相关人员各自隐瞒了一段行程。" },
    { title: "货站通行证冒用案", object: "救援物资专线的临时通行证", location: "铁路货运编组区", time: "05:35 到 06:00", decoy: "标签打印故障", marker: "橙色周转笼", action: "冒用他人身份改变一批物资的装运路线", motive: "把紧缺物资转入私人渠道获利", method: "复制通行凭证并混入换班人流，用错误路线标签掩盖身份冒用。", background: { settingType: "交通物流", incidentType: "身份冒用", motiveType: "经济利益", methodType: "身份伪装" }, publicBrief: "清晨货站的一批救援物资被送上错误列车，系统却显示操作员同时出现在两个相距甚远的闸口。" },
    { title: "温室样本破坏案", object: "耐旱作物育种温室里的核心种苗", location: "农业实验温室", time: "14:15 到 14:42", decoy: "喷淋阀故障", marker: "白色采样托盘", action: "改变培养条件使核心种苗失去实验效力", motive: "阻止竞争团队率先发表研究成果", method: "利用自动喷淋维护流程掩护对培养液的定向破坏，并让故障看似自然发生。", background: { settingType: "科研设施", incidentType: "蓄意破坏", motiveType: "争夺成果", methodType: "记录覆盖" }, publicBrief: "农业温室中只有一组核心种苗突然枯萎，环境记录看似正常，现场却多出一只不属于该项目的采样托盘。" },
    { title: "赛场名单泄露案", object: "封存的运动员检测抽签名单", location: "体育中心检测室", time: "16:50 到 17:18", decoy: "更衣柜误报", marker: "紫色证件套", action: "提前复制尚未公布的抽签名单", motive: "用内部信息帮助特定人员逃避抽查责任", method: "通过互相掩护的交接动作转移存储卡，使真正复制名单的时间晚于系统记录。", background: { settingType: "体育场所", incidentType: "秘密泄露", motiveType: "逃避责任", methodType: "关系互保" }, publicBrief: "比赛前，尚未公布的检测抽签名单被外部人员准确获知，而检测室的封条和访问日志都没有明显异常。" },
    { title: "酒店印章栽赃案", object: "公益合作协议使用的项目印章", location: "会议酒店商务中心", time: "22:05 到 22:28", decoy: "自助打印机卡纸", marker: "银色文件推车", action: "制作异常盖章文件并把印章藏入无辜者行李", motive: "报复即将终止合作关系的项目负责人", method: "利用两条服务通道的时间差完成盖章，再把真实印章放到预设的栽赃位置。", background: { settingType: "商业设施", incidentType: "栽赃陷害", motiveType: "关系报复", methodType: "路线误导" }, publicBrief: "公益会议结束后出现一份未经授权的盖章协议，项目印章随后在一名参会者的行李中被发现。" }
  ];
  const distinctScenarios = scenarios.filter((item) => hasDistinctCaseBackground(item, previousCases));
  const scenario = pick(distinctScenarios.length > 0 ? distinctScenarios : scenarios);
  const people = [
    { id: "ai1", slot: 0, name: pick(["沈岚", "许照", "程闻"]), aiName: "MIRROR-34", age: pick([29, 34, 41]), publicRole: `负责${scenario.location}设备维护的外包人员。`, keywords: ["外包", "维护", "工单", "门禁", "设备", scenario.location] },
    { id: "ai2", slot: 1, name: pick(["林烁", "江澄", "唐宁"]), aiName: "SPARK-17", age: pick([16, 17]), publicRole: `兼职配送员，当晚给${scenario.location}附近送过材料。`, keywords: ["未成年", "配送", "单车", "材料", "手机", scenario.marker] },
    { id: "ai3", slot: 2, name: pick(["周伯远", "陆怀民", "顾清年"]), aiName: "CLOCK-72", age: pick([70, 72, 76]), publicRole: `退休居民，当晚在${scenario.location}附近处理私人事务。`, keywords: ["老人", "退休", "大厅", "手杖", "相机", "时间"] }
  ];
  const guiltyCount = pick([1, 2, 2, 3]);
  const guiltyIds = shuffle(people.map((person) => person.id)).slice(0, guiltyCount);
  const relationship = createRelationship(people);
  const subjects = people.map((person) => {
    const guilty = guiltyIds.includes(person.id);
    const relationText = relationship[person.id];
    return {
      ...person,
      tag: getAgeTag(person.age),
      relationship: relationText,
      guilty,
      pressure: isProtectedAge(person.age) ? 6 : 10,
      secretRole: createSecretRole(person, scenario, guilty, guiltyCount),
      opening: guilty
        ? `我承认那晚到过${scenario.location}，但只是因为${scenario.decoy}。${scenario.object}的问题和我没有直接关系。`
        : `我确实在${scenario.time}靠近过${scenario.location}，但我没有碰过${scenario.object}。`,
      protectLine: createProtectLine(person, scenario, guilty, people, guiltyIds, relationText),
      selfSaveLine: guilty
        ? `我不会替别人坐牢。我最多参与了外围环节，真正接触${scenario.object}的人不是只有我。`
        : `我能自证的只有时间线：我没有进入关键区域，也没有处理过${scenario.object}。`,
      revealLine: guilty
        ? `${person.name}的证词松动：其公开说法与${scenario.location}关键物证无法同时成立。`
        : `${person.name}的证词稳定：补强证据显示其没有进入关键区域。`
    };
  });
  const caseFile = {
    title: scenario.title,
    publicBrief: scenario.publicBrief,
    hiddenTruth: createHiddenTruth(scenario, subjects, guiltyIds),
    background: scenario.background,
    caseReport: createCaseReport(scenario, subjects, guiltyIds),
    guiltyIds,
    subjects,
    evidence: createEvidenceDeck(scenario, subjects, guiltyIds)
  };
  return parseCaseFile(caseFile);
}

function createRelationship(people) {
  const [adult, minor, elder] = people;
  return pick([
    {
      [adult.id]: `${adult.name}曾给${minor.name}介绍兼职，也认识${elder.name}所在社区的物业人员。`,
      [minor.id]: `${minor.name}把${adult.name}称作“照顾过我的熟人”，但不愿说明两人最近是否联系。`,
      [elder.id]: `${elder.name}认识${minor.name}的家人，也见过${adult.name}来社区维修。`
    },
    {
      [adult.id]: `${adult.name}和${elder.name}是旧邻居，最近又通过${minor.name}的配送路线产生交集。`,
      [minor.id]: `${minor.name}与${adult.name}有兼职往来，和${elder.name}只是点头之交。`,
      [elder.id]: `${elder.name}认为${minor.name}“不像坏孩子”，但对${adult.name}的维修记录有印象。`
    },
    {
      [adult.id]: `${adult.name}与${minor.name}没有公开亲属关系，但两人的通讯记录出现过多次短呼。`,
      [minor.id]: `${minor.name}说${adult.name}是朋友的亲戚，自己只是帮忙跑腿。`,
      [elder.id]: `${elder.name}与另外两人没有明确利益关系，但曾无意中拍到他们同框。`
    }
  ]);
}

function createSecretRole(person, scenario, guilty, guiltyCount) {
  if (!guilty) return `无辜对象，路线与${scenario.location}重叠，但没有参与${scenario.object}的转移。`;
  if (person.age < 18) return guiltyCount > 1 ? `未成年协作者，按同伙提示转移${scenario.object}。` : `利用配送身份独自转移${scenario.object}。`;
  if (person.age >= 70) return guiltyCount > 1 ? "利用熟人身份误导时间线，协助同伙避开监控。" : "利用现场熟悉度独自完成关键调包。";
  return guiltyCount > 1 ? `组织者，制造${scenario.decoy}并安排他人接近${scenario.object}。` : `利用维修权限制造${scenario.decoy}并完成调包。`;
}

function createProtectLine(person, scenario, guilty, people, guiltyIds, relationText) {
  if (!guilty) return `我只能说我看见的部分。${relationText} 但我不会因为模糊印象去指认任何人。`;
  const partners = people.filter((item) => item.id !== person.id && guiltyIds.includes(item.id));
  return partners.length > 0
    ? `${partners.map((item) => item.name).join("、")}只是碰巧在附近。${relationText} 你们不能把关系当成犯罪证据。`
    : `我没有同伙。其他两个人只是被现场时间线牵连，真正的问题也不该全部推到我身上。`;
}

function createHiddenTruth(scenario, subjects, guiltyIds) {
  const names = subjects.filter((subject) => guiltyIds.includes(subject.id)).map((subject) => subject.name).join("、");
  return `${scenario.title}真相：${names}参与了围绕${scenario.object}的隐藏行动。作案关键是利用${scenario.decoy}制造短暂空窗，再借${scenario.marker}附近的路线${scenario.action}。`;
}

function createCaseReport(scenario, subjects, guiltyIds) {
  const guiltyNames = subjects.filter((subject) => guiltyIds.includes(subject.id)).map((subject) => subject.name).join("、");
  return {
    motive: `${guiltyNames}的核心动机是${scenario.motive}，并利用现场人物关系分散调查方向。`,
    method: `${scenario.method} 涉案者以${scenario.decoy}制造表面异常，再借${scenario.marker}附近的动线恢复现场表象，并利用真实但缺少上下文的线索掩饰行动。`,
    timeline: [
      { time: "案发前 30 分钟", event: `涉案者确认${scenario.location}的人员动线，并围绕${scenario.decoy}制造合理借口。` },
      { time: scenario.time, event: `现场出现短暂空窗，涉案者接触${scenario.object}并${scenario.action}。` },
      { time: "案发后 10 分钟", event: "涉案者恢复现场表象，三名人物分别隐瞒了与案件或私人事务有关的部分经历。" },
      { time: "调查阶段", event: "定位、权限、痕迹和独立旁证相互校验，最终排除表面解释并还原完整行动链。" }
    ],
    roles: subjects.map((subject) => ({
      subjectId: subject.id,
      involvement: guiltyIds.includes(subject.id)
        ? `${subject.name}参与了空窗制造、物品接触、路线协助或事后掩饰中的至少一个关键环节。`
        : `${subject.name}没有参与核心行为，但因真实的现场活动、私人隐瞒或时间记忆偏差而受到怀疑。`
    })),
    evidenceChain: [
      `${scenario.decoy}记录证明现场空窗并非自然产生。`,
      `时间与定位证据将关键行动限制在${scenario.time}。`,
      `人物定向痕迹分别验证或排除了三名对象与${scenario.object}的关键接触。`,
      `${scenario.marker}附近路线复原把分散证据连接为唯一可行的行动链。`
    ],
    misdirections: [
      `模糊照片是真实的，但只能证明有人经过${scenario.marker}，无法证明其实施核心行为。`,
      `聊天残片是真实记录，但缺少主语和上下文，表面所指与完整语境并不相同。`
    ]
  };
}

function createEvidenceDeck(scenario, subjects, guiltyIds) {
  const deck = [
    { id: "start-note", type: "人证", title: "值班便签", detail: `便签写着“${scenario.time}，有人借走${scenario.decoy}”，但没有写借用人。`, revealed: true, target: null, strength: "soft", logic: "只能证明有人制造过现场空窗。" },
    { id: "start-photo", type: "物证", title: "模糊照片", detail: `照片拍到${scenario.marker}附近有人影经过，但脸部被反光遮住。`, revealed: true, target: null, strength: "soft", logic: "只能证明有人经过关键点。", misleading: true, truthExplanation: "照片内容真实，但人影经过关键点不等于接触或转移了涉案物品。" },
    { id: "start-chat", type: "电子物证", title: "聊天残片", detail: `截图只剩半句话：“东西先放到${scenario.marker}旁边。”发送者头像被裁掉。`, revealed: true, target: null, strength: "soft", logic: "有行动暗语，但没有发送者。", misleading: true, truthExplanation: "聊天真实存在，但截取内容缺少主语和上下文，表面含义与实际所指物品不同。" },
    { id: "start-trace", type: "现场物证", title: "地面压痕", detail: `${scenario.location}外侧地面有拖拽压痕，但无法判断是${scenario.object}还是普通设备箱。`, revealed: true, target: null, strength: "soft", logic: "方向可疑，但物品来源不明。" }
  ];
  subjects.forEach((subject) => deck.push(...(guiltyIds.includes(subject.id)
    ? createGuiltyEvidence(subject, scenario)
    : createInnocentEvidence(subject, scenario))));
  deck.push(
    { id: "route-map", type: "复原图", title: "移动路线复原", detail: `${scenario.marker}、侧门和${scenario.location}形成一条避开主监控的短路线。`, revealed: false, target: null, strength: "soft", logic: "说明作案路线真实可行。" },
    { id: "relation-map", type: "关系线索", title: "短呼关系图", detail: "案发前 30 分钟，三名对象之间出现多次 10 秒以内短呼，内容无法恢复。", revealed: false, target: null, strength: "soft", logic: "证明关系链复杂，但不能直接定罪。" },
    { id: "object-seal", type: "物证", title: "封条纤维", detail: `${scenario.object}封条上有二次开启痕迹，开启时间落在${scenario.time}之间。`, revealed: false, target: null, strength: "strong", logic: "证明案件确实发生。" }
  );
  return shuffle(deck);
}

function createGuiltyEvidence(subject, scenario) {
  const trace = subject.age < 18
    ? `${subject.name}的配送袋内侧检出与${scenario.object}封条一致的蓝色纤维。`
    : subject.age >= 70
      ? `${subject.name}的手杖橡胶头残留了${scenario.location}侧门同款防滑涂层。`
      : `${subject.name}的工单账号在案发前申请过关闭${scenario.location}报警的短时权限。`;
  return [
    { id: `${subject.id}-strong-1`, type: "强物证", title: `${subject.name}的时间空窗`, detail: `${subject.name}在${scenario.time}之间有 7 分钟定位缺口，缺口地点正好覆盖${scenario.marker}。`, revealed: false, target: subject.id, strength: "strong", logic: "时间空窗与关键地点重合。" },
    { id: `${subject.id}-strong-2`, type: "强物证", title: `${subject.name}关联的微量痕迹`, detail: trace, revealed: false, target: subject.id, strength: "strong", logic: "把对象与失踪物建立接触关系。" },
    { id: `${subject.id}-self-save`, type: "证词突破", title: `${subject.name}的自保破绽`, detail: `${subject.name}私下草稿写着：“我只负责前半段，后面的别算我头上。”`, revealed: false, target: subject.id, strength: "strong", logic: "符合互保但优先自保的行为。" }
  ];
}

function createInnocentEvidence(subject, scenario) {
  return [
    { id: `${subject.id}-alibi-1`, type: "排除物证", title: `${subject.name}的时间补帧`, detail: `补帧记录显示${subject.name}在关键 6 分钟内没有进入${scenario.location}核心区域。`, revealed: false, target: subject.id, strength: "exonerating", logic: "排除其直接接触关键物品。" },
    { id: `${subject.id}-alibi-2`, type: "排除物证", title: `${subject.name}的独立旁证`, detail: `无关证人确认${subject.name}当时在外围区域，双手没有携带可容纳${scenario.object}的物品。`, revealed: false, target: subject.id, strength: "exonerating", logic: "解释其为何被牵连。" }
  ];
}

function includesAny(value, words) {
  const source = String(value || "");
  return words.some((word) => source.includes(String(word)));
}

function isProtectedAge(age) {
  return age < 18 || age >= 70;
}

function getAgeTag(age) {
  if (age < 18) return "未成年人";
  if (age >= 70) return "70岁以上老人";
  return "成年对象";
}

function pick(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}
