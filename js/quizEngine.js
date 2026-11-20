/**
 * NeuroCorridor-3D — Pure Neuroanatomy Quiz State Machine & Educational Report Exporter
 *
 * Zero-DOM pure ES Module.
 * Educational & Research Sandbox — Not Approved for Clinical Neuronavigation.
 * 100% Browser-Local — Zero Uploads.
 */

export const CLINICAL_DISCLAIMER =
  'Educational & Research Sandbox — Not Approved for Clinical Neuronavigation';
export const PRIVACY_NOTICE = '100% Browser-Local — Zero Uploads';

const CASE_CATEGORY_LABELS = Object.freeze({
  case01_right_frontal_gbm: 'Frontal Motor & SMA Pathways',
  case02_left_insular_lgg: 'Insular & Dual-Stream Language Tracts',
  case03_left_tpo_met: 'Temporo-Parieto-Occipital & Optic Radiation',
  case04_left_parasagittal_meningioma: 'Parasagittal Venous Sinus & Rolandic Cortex',
  case05_sellar_pituitary: 'Endoscopic Skull Base & Chiasm/ICA',
});

function formatCoord(pt) {
  if (!Array.isArray(pt) || pt.length < 3) return 'N/A';
  return `(${Number(pt[0]).toFixed(1)}, ${Number(pt[1]).toFixed(1)}, ${Number(
    pt[2]
  ).toFixed(1)}) mm`;
}

function formatNum(val, digits = 1) {
  return Number.isFinite(val) ? Number(val).toFixed(digits) : 'N/A';
}

function classifyMasteryTier(accuracyPercent) {
  if (accuracyPercent >= 90) return 'Attending Stereotactic Mastery';
  if (accuracyPercent >= 75) return 'Senior Neurosurgical Resident';
  if (accuracyPercent >= 50) return 'Neuroanatomy Fellow in Training';
  return 'Foundational Atlas Review Recommended';
}

function resolveQuestionCategory(question) {
  if (question && typeof question.category === 'string' && question.category.trim()) {
    return question.category.trim();
  }
  if (question && question.caseId && CASE_CATEGORY_LABELS[question.caseId]) {
    return CASE_CATEGORY_LABELS[question.caseId];
  }
  if (question && question.caseId) {
    return question.caseId;
  }
  return 'General Neuroanatomy';
}

/**
 * Pure, deterministic state machine managing interactive neuroanatomy & surgical-corridor
 * quiz progression, first-attempt answer locking, category breakdown, and mastery summaries.
 */
export class NeuroQuizEngine {
  /**
   * @param {Array<object>} [questions=[]]
   */
  constructor(questions = []) {
    this._questions = Array.isArray(questions)
      ? questions.map((q) => ({
          ...q,
          options: Array.isArray(q.options) ? q.options.slice() : [],
          highlightStructureIds: Array.isArray(q.highlightStructureIds)
            ? q.highlightStructureIds.slice()
            : [],
        }))
      : [];
    this._currentIndex = 0;
    this._answersById = new Map();
  }

  reset() {
    this._currentIndex = 0;
    this._answersById.clear();
    return this.getProgress();
  }

  getQuestionCount() {
    return this._questions.length;
  }

  getCurrentIndex() {
    return this._currentIndex;
  }

  getCurrentQuestion() {
    if (this._questions.length === 0) return null;
    return this._questions[this._currentIndex] || null;
  }

  selectQuestion(index) {
    if (this._questions.length === 0) return null;
    const numeric = Number.isFinite(index) ? Math.trunc(index) : 0;
    this._currentIndex = Math.max(
      0,
      Math.min(this._questions.length - 1, numeric)
    );
    return this.getCurrentQuestion();
  }

  nextQuestion() {
    if (this._questions.length === 0) return null;
    if (this._currentIndex < this._questions.length - 1) {
      this._currentIndex++;
    }
    return this.getCurrentQuestion();
  }

  prevQuestion() {
    if (this._questions.length === 0) return null;
    if (this._currentIndex > 0) {
      this._currentIndex--;
    }
    return this.getCurrentQuestion();
  }

  /**
   * Validates and locks an answer for the current question.
   * Re-submitting an already answered question preserves the original locked record
   * and returns alreadyAnswered: true.
   *
   * @param {number} optionIndex
   */
  submitAnswer(optionIndex) {
    const q = this.getCurrentQuestion();
    if (!q) return null;

    const idx = Math.trunc(Number(optionIndex));
    if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) {
      throw new RangeError(
        `Invalid quiz optionIndex (${optionIndex}) for question "${q.id}" (expected 0..${
          q.options.length - 1
        }).`
      );
    }

    let alreadyAnswered = false;
    let record = this._answersById.get(q.id);

    if (record) {
      alreadyAnswered = true;
    } else {
      const isCorrect = idx === q.correctIndex;
      record = {
        selectedIndex: idx,
        isCorrect,
      };
      this._answersById.set(q.id, record);
    }

    let score = 0;
    for (const ans of this._answersById.values()) {
      if (ans.isCorrect) score++;
    }

    return {
      questionId: q.id,
      isCorrect: record.isCorrect,
      correctIndex: q.correctIndex,
      selectedIndex: record.selectedIndex,
      alreadyAnswered,
      explanation: q.explanation || '',
      pearl: q.pearl || '',
      score,
      answeredCount: this._answersById.size,
      totalCount: this._questions.length,
    };
  }

  getAnswerRecord(questionId) {
    const rec = this._answersById.get(questionId);
    return rec
      ? { selectedIndex: rec.selectedIndex, isCorrect: rec.isCorrect }
      : null;
  }

  getProgress() {
    const totalCount = this._questions.length;
    const answeredCount = this._answersById.size;
    let correctCount = 0;
    const answersById = {};

    for (const [id, rec] of this._answersById.entries()) {
      if (rec.isCorrect) correctCount++;
      answersById[id] = {
        selectedIndex: rec.selectedIndex,
        isCorrect: rec.isCorrect,
      };
    }

    const percentComplete =
      totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
    const accuracyPercent =
      answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
    const isComplete = totalCount > 0 && answeredCount === totalCount;

    return {
      currentIndex: this._currentIndex,
      answeredCount,
      correctCount,
      totalCount,
      percentComplete,
      accuracyPercent,
      isComplete,
      answersById,
    };
  }

  /**
   * Computes accuracy and completion metrics grouped by neuroanatomical curriculum domain.
   * @returns {Array<{ category: string, caseId: string|null, total: number, answered: number, correct: number, accuracyPercent: number }>}
   */
  getCategoryBreakdown() {
    const buckets = new Map();

    for (const q of this._questions) {
      const category = resolveQuestionCategory(q);
      if (!buckets.has(category)) {
        buckets.set(category, {
          category,
          caseId: q.caseId || null,
          total: 0,
          answered: 0,
          correct: 0,
        });
      }
      const bucket = buckets.get(category);
      bucket.total++;
      const rec = this._answersById.get(q.id);
      if (rec) {
        bucket.answered++;
        if (rec.isCorrect) bucket.correct++;
      }
    }

    return Array.from(buckets.values()).map((b) => ({
      ...b,
      accuracyPercent:
        b.answered > 0 ? Math.round((b.correct / b.answered) * 100) : 0,
    }));
  }

  getSummary() {
    const progress = this.getProgress();
    const score = progress.correctCount;
    const totalCount = progress.totalCount;
    const answeredCount = progress.answeredCount;

    const accuracyPercent =
      totalCount > 0 && answeredCount === totalCount
        ? Math.round((score / totalCount) * 100)
        : progress.accuracyPercent;

    const tierLabel = classifyMasteryTier(accuracyPercent);
    const missedQuestions = [];

    for (const q of this._questions) {
      const rec = this._answersById.get(q.id);
      if (rec && !rec.isCorrect) {
        missedQuestions.push({
          id: q.id,
          caseId: q.caseId || null,
          category: resolveQuestionCategory(q),
          question: q.question,
          selectedIndex: rec.selectedIndex,
          selectedOption: q.options[rec.selectedIndex] || '',
          correctIndex: q.correctIndex,
          correctOption: q.options[q.correctIndex] || '',
          explanation: q.explanation || '',
          pearl: q.pearl || '',
        });
      }
    }

    return {
      score,
      answeredCount,
      totalCount,
      accuracyPercent,
      tierLabel,
      missedQuestions,
      categoryBreakdown: this.getCategoryBreakdown(),
    };
  }
}

// ============================================================================
// Educational Summary Report Generators (Markdown & JSON)
// ============================================================================

/**
 * Generates a structured JSON-serializable educational summary object for local export.
 */
export function generateEducationalReportJson({
  caseData = null,
  corridor = null,
  analysis = null,
  customNiftiInfo = null,
  quizSummary = null,
  timestampIso = new Date().toISOString(),
} = {}) {
  const serializeHazard = (h) => ({
    id: h.id,
    name: h.name,
    shortName: h.shortName,
    kind: h.kind,
    category: h.category,
    hemisphere: h.hemisphere,
    centerlineDistanceMm: Number(formatNum(h.centerlineDistanceMm, 2)),
    corridorClearanceMm: Number(formatNum(h.corridorClearanceMm, 2)),
    lesionClearanceMm: Number.isFinite(h.lesionClearanceMm)
      ? Number(formatNum(h.lesionClearanceMm, 2))
      : null,
    riskTier: h.riskTier,
    lesionRiskTier: h.lesionRiskTier,
    depthPercent: Number(formatNum((h.depthFraction || 0) * 100, 1)),
    corridorClosestPointMni: h.corridorClosestPoint,
    hazardClosestPointMni: h.hazardClosestPoint,
  });

  return {
    schemaVersion: '1.0.0',
    application: 'NeuroCorridor-3D',
    disclaimer: CLINICAL_DISCLAIMER,
    privacyNotice: PRIVACY_NOTICE,
    coordinateSystem: 'MNI-152-RAS+',
    units: 'mm',
    generatedAt: timestampIso,
    caseSummary: caseData
      ? {
          id: caseData.id || null,
          title: caseData.title || 'Custom Case',
          pathology: caseData.pathology || null,
          approachName: caseData.approachName || null,
          recommendedMapping: caseData.recommendedMapping || null,
          clinicalPresentation: caseData.clinicalPresentation || null,
          surgicalPearls: Array.isArray(caseData.surgicalPearls)
            ? caseData.surgicalPearls.slice()
            : [],
        }
      : null,
    customNiftiInfo: customNiftiInfo
      ? {
          fileName: customNiftiInfo.fileName || null,
          dimensions: customNiftiInfo.dimensions || null,
          voxelSpacingMm: customNiftiInfo.voxelSpacingMm || null,
          affineSource: customNiftiInfo.affineSource || null,
          voxelCount: customNiftiInfo.voxelCount || 0,
          volumeCm3: Number.isFinite(customNiftiInfo.volumeCm3)
            ? Number(customNiftiInfo.volumeCm3.toFixed(2))
            : null,
          centroidMni: customNiftiInfo.centroidMni || null,
          primaryEllipsoid: customNiftiInfo.primaryEllipsoid || null,
          warnings: Array.isArray(customNiftiInfo.warnings)
            ? customNiftiInfo.warnings.slice()
            : [],
        }
      : null,
    corridor: corridor
      ? {
          approachMode: corridor.approachMode || 'transcortical',
          entryMni: corridor.entryMni,
          targetMni: corridor.targetMni,
          radiusMm: corridor.radiusMm,
        }
      : null,
    analysis: analysis
      ? {
          overallRiskTier: analysis.overallRiskTier,
          trajectoryLengthMm: Number(formatNum(analysis.trajectoryLengthMm, 2)),
          corticalEntryDepthMm: Number(
            formatNum(analysis.corticalEntryDepthMm, 2)
          ),
          corridorRadiusMm: analysis.corridorRadiusMm,
          criticalCount: (analysis.criticalViolations || []).length,
          cautionCount: (analysis.cautionStructures || []).length,
          criticalViolations: (analysis.criticalViolations || []).map(
            serializeHazard
          ),
          cautionStructures: (analysis.cautionStructures || []).map(
            serializeHazard
          ),
          sortedHazards: (analysis.sortedHazards || []).map(serializeHazard),
        }
      : null,
    quizSummary: quizSummary || null,
  };
}

/**
 * Generates a clean, clinician-readable Markdown educational planning report.
 * Prominently embeds both the non-clinical disclaimer and 100% browser-local privacy notice.
 */
export function generateEducationalReportMarkdown({
  caseData = null,
  corridor = null,
  analysis = null,
  customNiftiInfo = null,
  quizSummary = null,
  timestampIso = new Date().toISOString(),
} = {}) {
  const lines = [];

  lines.push('# NeuroCorridor-3D — Stereotactic Surgical Corridor Study Report');
  lines.push('');
  lines.push(`> **WARNING:** ${CLINICAL_DISCLAIMER}`);
  lines.push(`> **PRIVACY:** ${PRIVACY_NOTICE}`);
  lines.push('');
  lines.push(`- **Generated:** \`${timestampIso}\``);
  lines.push('- **Coordinate Space:** MNI-152 RAS+ (`+X` Right, `+Y` Anterior, `+Z` Superior, Origin = AC, units in `mm`)');
  lines.push('');

  if (caseData) {
    lines.push('## 1. Case Overview');
    lines.push('');
    lines.push(`- **Case:** ${caseData.title || caseData.id || 'Custom Study'}`);
    if (caseData.pathology) lines.push(`- **Pathology:** ${caseData.pathology}`);
    if (caseData.approachName) {
      lines.push(`- **Reference Approach:** ${caseData.approachName}`);
    }
    if (caseData.recommendedMapping) {
      lines.push(`- **Neuromonitoring / Mapping:** ${caseData.recommendedMapping}`);
    }
    if (caseData.clinicalPresentation) {
      lines.push('');
      lines.push(caseData.clinicalPresentation);
    }
    lines.push('');
  }

  if (customNiftiInfo) {
    lines.push('## Local NIfTI-1 Lesion Mask (Parsed in Browser Memory)');
    lines.push('');
    lines.push(`- **File:** \`${customNiftiInfo.fileName || 'custom_mask.nii.gz'}\``);
    if (customNiftiInfo.dimensions) {
      lines.push(`- **Matrix:** \`${customNiftiInfo.dimensions.join(' x ')}\``);
    }
    if (customNiftiInfo.voxelSpacingMm) {
      lines.push(
        `- **Voxel Spacing:** ${customNiftiInfo.voxelSpacingMm
          .map((v) => formatNum(v, 2))
          .join(' x ')} mm`
      );
    }
    lines.push(`- **Affine Source:** \`${customNiftiInfo.affineSource || 'unknown'}\``);
    lines.push(
      `- **Volume:** ${formatNum(customNiftiInfo.volumeCm3, 2)} cm³ (${
        customNiftiInfo.voxelCount || 0
      } voxels)`
    );
    lines.push(`- **Centroid (MNI):** ${formatCoord(customNiftiInfo.centroidMni)}`);
    if (Array.isArray(customNiftiInfo.warnings) && customNiftiInfo.warnings.length > 0) {
      lines.push('- **Parser Warnings:**');
      for (const w of customNiftiInfo.warnings) {
        lines.push(`  - ${w}`);
      }
    }
    lines.push('');
  }

  if (corridor && analysis) {
    lines.push('## 2. Surgical Corridor Geometry & Risk Summary');
    lines.push('');
    lines.push(`- **Overall Risk Tier:** **${String(analysis.overallRiskTier || 'safe').toUpperCase()}**`);
    lines.push(`- **Approach Mode:** \`${corridor.approachMode || analysis.approachMode || 'transcortical'}\``);
    lines.push(`- **Entry Point (MNI):** ${formatCoord(corridor.entryMni)}`);
    lines.push(`- **Target Point (MNI):** ${formatCoord(corridor.targetMni)}`);
    lines.push(`- **Corridor Radius:** ${formatNum(corridor.radiusMm, 1)} mm (Diameter ${formatNum((corridor.radiusMm || 0) * 2, 1)} mm)`);
    lines.push(`- **Trajectory Length:** ${formatNum(analysis.trajectoryLengthMm, 1)} mm`);
    lines.push(`- **Parenchyma Traversal Depth:** ${formatNum(analysis.corticalEntryDepthMm, 1)} mm`);
    lines.push(
      `- **Hazard Counts:** ${(analysis.criticalViolations || []).length} Critical (< 5 mm) | ${(analysis.cautionStructures || []).length} Caution (5–10 mm)`
    );
    lines.push('');

    lines.push('## 3. Stereotactic Proximity Hazard Matrix');
    lines.push('');
    lines.push(
      '| Rank | Structure / Tract | Type | Hemisphere | Corridor Clearance | Lesion Margin | Risk Tier | Depth % |'
    );
    lines.push('|---:|---|---|---|---:|---:|---|---:|');

    const hazards = analysis.sortedHazards || [];
    hazards.forEach((h, i) => {
      const tier = String(h.riskTier || 'safe').toUpperCase();
      lines.push(
        `| ${i + 1} | ${h.name} (\`${h.shortName}\`) | ${h.kind} | ${h.hemisphere} | ${formatNum(
          h.corridorClearanceMm,
          1
        )} mm | ${formatNum(h.lesionClearanceMm, 1)} mm | **${tier}** | ${formatNum(
          (h.depthFraction || 0) * 100,
          0
        )}% |`
      );
    });
    lines.push('');
  }

  if (caseData && Array.isArray(caseData.surgicalPearls) && caseData.surgicalPearls.length > 0) {
    lines.push('## 4. Operative Pearls');
    lines.push('');
    for (const pearl of caseData.surgicalPearls) {
      lines.push(`- ${pearl}`);
    }
    lines.push('');
  }

  if (quizSummary) {
    lines.push('## 5. Neuroanatomy Quiz Performance');
    lines.push('');
    lines.push(
      `- **Score:** ${quizSummary.score} / ${quizSummary.totalCount} (${quizSummary.accuracyPercent}%)`
    );
    if (quizSummary.tierLabel) {
      lines.push(`- **Mastery Level:** ${quizSummary.tierLabel}`);
    }
    if (Array.isArray(quizSummary.categoryBreakdown) && quizSummary.categoryBreakdown.length > 0) {
      lines.push('');
      lines.push('| Domain | Answered | Correct | Accuracy |');
      lines.push('|---|---:|---:|---:|');
      for (const cat of quizSummary.categoryBreakdown) {
        lines.push(
          `| ${cat.category} | ${cat.answered}/${cat.total} | ${cat.correct} | ${cat.accuracyPercent}% |`
        );
      }
    }
    if (Array.isArray(quizSummary.missedQuestions) && quizSummary.missedQuestions.length > 0) {
      lines.push('');
      lines.push('### Review Pearls for Missed Items');
      lines.push('');
      for (const item of quizSummary.missedQuestions) {
        lines.push(`- **${item.id}:** ${item.pearl || item.explanation}`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*${CLINICAL_DISCLAIMER}. ${PRIVACY_NOTICE}.*`);
  lines.push('');

  return lines.join('\n');
}
