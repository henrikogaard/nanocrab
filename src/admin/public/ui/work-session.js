(function () {
  var supportedStatuses = new Set([
    'running',
    'waiting_approval',
    'failed',
    'completed',
    'cancelled',
    'interrupted',
  ]);

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function asRecord(value) {
    return isRecord(value) ? value : {};
  }

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!isRecord(value)) return value;

    var copy = {};
    Object.keys(value).forEach(function (key) {
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: cloneValue(value[key]),
        writable: true,
      });
    });
    return copy;
  }

  function hasValue(value) {
    return (
      value !== undefined &&
      value !== null &&
      !(typeof value === 'string' && value.trim() === '')
    );
  }

  function firstValue(values) {
    for (var index = 0; index < values.length; index += 1) {
      if (hasValue(values[index])) return values[index];
    }
    return '';
  }

  function stringValue(value) {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  }

  function normalizeStatus(value) {
    if (typeof value !== 'string') return 'unknown';
    var status = value.trim().toLowerCase();
    return supportedStatuses.has(status) ? status : 'unknown';
  }

  function timestampValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || value.trim() === '') return null;
    var parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizedTimeline(cockpit, streamEvents) {
    var stream = Array.isArray(streamEvents)
      ? streamEvents
      : asRecord(streamEvents).events;
    var candidates = [];

    if (Array.isArray(cockpit.timeline)) {
      candidates = candidates.concat(cockpit.timeline);
    }
    if (Array.isArray(stream)) candidates = candidates.concat(stream);

    var seenIdentities = new Map();
    var accepted = [];
    candidates.forEach(function (candidate, order) {
      if (!isRecord(candidate)) return;
      var time = timestampValue(candidate.timestamp);
      if (time === null) return;
      if (typeof candidate.type !== 'string' || candidate.type.trim() === '') {
        return;
      }

      var stableId =
        typeof candidate.id === 'string' && candidate.id.trim()
          ? candidate.id.trim()
          : typeof candidate.id === 'number' && Number.isFinite(candidate.id)
            ? String(candidate.id)
            : '';
      var eventType = candidate.type.trim().toLowerCase();
      var identity = stableId ? JSON.stringify([stableId, eventType]) : '';
      var item = {
        event: cloneValue(candidate),
        order: order,
        time: time,
      };
      // Stable ID and lifecycle type identify one logical event. This keeps a
      // tool call and its result distinct even when producers reuse the ID.
      // Within one identity, newest wins; stream wins an exact timestamp tie.
      if (identity && seenIdentities.has(identity)) {
        var existingIndex = seenIdentities.get(identity);
        if (time >= accepted[existingIndex].time) {
          accepted[existingIndex] = item;
        }
        return;
      }
      if (identity) seenIdentities.set(identity, accepted.length);
      accepted.push(item);
    });

    // Anonymous events are intentionally never deduplicated. Stable input order
    // breaks timestamp ties so distinct anonymous events remain deterministic.
    accepted.sort(function (left, right) {
      return left.time - right.time || left.order - right.order;
    });
    return accepted.map(function (item) {
      return item.event;
    });
  }

  function progressFromTimeline(timeline) {
    var progress = null;
    timeline.forEach(function (event) {
      if (
        String(event.type || '')
          .trim()
          .toLowerCase() !== 'progress'
      )
        return;
      if (typeof event.pct !== 'number' || !Number.isFinite(event.pct)) return;
      progress = Math.min(100, Math.max(0, event.pct));
    });
    return progress;
  }

  function collectRecords(values) {
    var records = [];
    values.forEach(function (value) {
      if (!Array.isArray(value)) return;
      value.forEach(function (entry) {
        if (isRecord(entry)) records.push(cloneValue(entry));
      });
    });
    return records;
  }

  function collectFiles(values) {
    var files = [];
    var seen = Object.create(null);
    values.forEach(function (value) {
      if (!Array.isArray(value)) return;
      value.forEach(function (entry) {
        if (typeof entry !== 'string' || entry.trim() === '') return;
        var file = entry.trim();
        if (seen[file]) return;
        seen[file] = true;
        files.push(file);
      });
    });
    return files;
  }

  function structuredToolCalls(structured) {
    if (!Array.isArray(structured.messages)) return [];
    var toolCalls = [];
    structured.messages.forEach(function (message) {
      if (!isRecord(message) || !Array.isArray(message.toolCalls)) return;
      message.toolCalls.forEach(function (toolCall) {
        if (isRecord(toolCall)) toolCalls.push(cloneValue(toolCall));
      });
    });
    return toolCalls;
  }

  function capabilitiesForStatus(status) {
    switch (status) {
      case 'running':
        return {
          canCancel: true,
          canRetry: false,
          canResume: true,
          isReadOnly: false,
        };
      case 'waiting_approval':
        return {
          canCancel: true,
          canRetry: false,
          canResume: false,
          isReadOnly: false,
        };
      case 'failed':
      case 'cancelled':
        return {
          canCancel: false,
          canRetry: true,
          canResume: false,
          isReadOnly: false,
        };
      case 'completed':
        return {
          canCancel: false,
          canRetry: false,
          canResume: true,
          isReadOnly: false,
        };
      case 'interrupted':
      case 'unknown':
      default:
        return {
          canCancel: false,
          canRetry: false,
          canResume: false,
          isReadOnly: true,
        };
    }
  }

  function nextAction(session) {
    var model = asRecord(session);
    var status = normalizeStatus(model.status);
    if (status === 'waiting_approval') return 'review_approvals';
    if (
      (status === 'failed' || status === 'cancelled') &&
      model.canRetry === true
    ) {
      return 'retry';
    }
    if (
      (status === 'running' || status === 'completed') &&
      model.canResume === true
    ) {
      return 'resume';
    }
    if (status === 'running' && model.canCancel === true) return 'cancel';
    return null;
  }

  function normalize(summary, cockpitDetail, structuredDetail, streamEvents) {
    var summaryRecord = asRecord(summary);
    var cockpit = asRecord(cockpitDetail);
    var structured = asRecord(structuredDetail);
    var stats = asRecord(structured.stats);
    var status = normalizeStatus(
      firstValue([cockpit.status, summaryRecord.status, structured.status]),
    );
    var timeline = normalizedTimeline(cockpit, streamEvents);
    var capabilities = capabilitiesForStatus(status);

    return {
      id: stringValue(
        firstValue([
          cockpit.id,
          cockpit.sessionId,
          summaryRecord.id,
          summaryRecord.sessionId,
          structured.id,
          structured.sessionId,
        ]),
      ),
      group: stringValue(
        firstValue([cockpit.group, summaryRecord.group, structured.group]),
      ),
      mode: stringValue(
        firstValue([cockpit.mode, summaryRecord.mode, structured.mode]),
      ),
      status: status,
      currentStep: stringValue(
        firstValue([
          cockpit.currentStep,
          summaryRecord.currentStep,
          structured.currentStep,
        ]),
      ),
      startedAt: stringValue(
        firstValue([
          cockpit.startedAt,
          summaryRecord.startedAt,
          structured.startedAt,
          stats.createdAt,
        ]),
      ),
      updatedAt: stringValue(
        firstValue([
          cockpit.updatedAt,
          cockpit.lastEventAt,
          summaryRecord.updatedAt,
          summaryRecord.lastEventAt,
          summaryRecord.lastActivity,
          structured.updatedAt,
          structured.lastEventAt,
          stats.endedAt,
          stats.createdAt,
        ]),
      ),
      progressPct: progressFromTimeline(timeline),
      timeline: timeline,
      toolCalls: structuredToolCalls(structured),
      changedFiles: collectFiles([
        cockpit.changedFiles,
        summaryRecord.changedFiles,
        structured.changedFiles,
      ]),
      artifacts: collectRecords([
        cockpit.artifacts,
        cockpit.deliverables,
        summaryRecord.artifacts,
        summaryRecord.deliverables,
        structured.artifacts,
        structured.deliverables,
      ]),
      proposals: collectRecords([
        cockpit.proposals,
        summaryRecord.proposals,
        structured.proposals,
      ]),
      approvals: collectRecords([
        cockpit.approvals,
        summaryRecord.approvals,
        structured.approvals,
      ]),
      canCancel: capabilities.canCancel,
      canRetry: capabilities.canRetry,
      canResume: capabilities.canResume,
      isReadOnly: capabilities.isReadOnly,
    };
  }

  window.NanoWorkSession = {
    normalize: normalize,
    normalizeStatus: normalizeStatus,
    nextAction: nextAction,
  };
})();
