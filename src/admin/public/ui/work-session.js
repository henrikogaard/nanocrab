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

  function exactEventContentIdentity(stableId, event) {
    if (
      !stableId ||
      (typeof event.timestamp !== 'string' &&
        typeof event.timestamp !== 'number') ||
      typeof event.title !== 'string' ||
      typeof event.detail !== 'string'
    ) {
      return '';
    }
    return JSON.stringify([
      stableId,
      typeof event.timestamp,
      event.timestamp,
      event.title,
      event.detail,
    ]);
  }

  function normalizedTimeline(cockpit, streamEvents) {
    var stream = Array.isArray(streamEvents)
      ? streamEvents
      : asRecord(streamEvents).events;
    var candidates = [];

    if (Array.isArray(cockpit.timeline)) {
      cockpit.timeline.forEach(function (event) {
        candidates.push({ event: event, source: 'cockpit' });
      });
    }
    if (Array.isArray(stream)) {
      stream.forEach(function (event) {
        candidates.push({ event: event, source: 'stream' });
      });
    }

    var seenIdentities = new Map();
    var seenContentIdentities = new Map();
    var accepted = [];
    function rememberContentIdentity(identity, index) {
      if (!identity) return;
      var indexes = seenContentIdentities.get(identity) || [];
      if (indexes.indexOf(index) === -1) indexes.push(index);
      seenContentIdentities.set(identity, indexes);
    }

    candidates.forEach(function (candidateEntry, order) {
      var candidate = candidateEntry.event;
      var source = candidateEntry.source;
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
      var contentIdentity = exactEventContentIdentity(stableId, candidate);
      var item = {
        contentIdentity: contentIdentity,
        event: cloneValue(candidate),
        order: order,
        source: source,
        time: time,
      };
      // Stable ID and lifecycle type identify one logical event. This keeps a
      // tool call and its result distinct even when producers reuse the ID.
      // Within one identity, newest wins; stream wins an exact timestamp tie.
      if (identity && seenIdentities.has(identity)) {
        var existingIndex = seenIdentities.get(identity);
        if (time >= accepted[existingIndex].time) {
          accepted[existingIndex] = item;
          rememberContentIdentity(contentIdentity, existingIndex);
        }
        return;
      }

      // The sessions fallback endpoint copies timestamp/title/detail exactly
      // but can relabel the event type. Collapse that representation only when
      // the matching payload came from the other surface.
      var contentIndexes = seenContentIdentities.get(contentIdentity) || [];
      var isCrossSurfaceCopy = contentIndexes.some(function (index) {
        var existing = accepted[index];
        return (
          existing &&
          existing.contentIdentity === contentIdentity &&
          existing.source !== source
        );
      });
      if (contentIdentity && isCrossSurfaceCopy) return;

      if (identity) seenIdentities.set(identity, accepted.length);
      rememberContentIdentity(contentIdentity, accepted.length);
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

  function projectionValue(value) {
    var record = asRecord(value);
    var items = Array.isArray(record.items)
      ? record.items.filter(isRecord).map(cloneValue)
      : [];
    return {
      available: record.available === true && items.length > 0,
      reason:
        typeof record.reason === 'string' && record.reason.trim()
          ? record.reason
          : items.length > 0
            ? 'recorded'
            : 'not_recorded',
      items: items,
    };
  }

  function sessionProjections(values) {
    var source = {};
    values.forEach(function (value) {
      var record = asRecord(value);
      var projections = asRecord(record.projections);
      Object.keys(projections).forEach(function (key) {
        if (source[key] === undefined) source[key] = projections[key];
      });
    });
    return {
      conversation: projectionValue(source.conversation),
      plan: projectionValue(source.plan),
      memoryProposals: projectionValue(source.memoryProposals),
      skillProposals: projectionValue(source.skillProposals),
      journalEvents: projectionValue(source.journalEvents),
    };
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

function renderToolCallTimeline(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return '<div class="session-tool-timeline-empty">No tool calls in this session</div>';
  }
  var timeline = '<div class="session-tool-timeline"><div class="session-tool-timeline-header"><span>Tool Call Timeline</span><span class="badge badge-info">' + toolCalls.length + ' calls</span></div>';
  timeline += '<div class="session-tool-timeline-bar">';
  for (var i = 0; i < toolCalls.length; i++) {
    var tc = toolCalls[i];
    var name = isRecord(tc) && tc.name ? esc(tc.name) : 'unknown';
    var status = isRecord(tc) && tc.output ? 'done' : 'running';
    var duration = isRecord(tc) && tc.duration ? tc.duration + 's' : '';
    timeline += '<div class="session-tool-timeline-item" title="' + name + ' (' + duration + ')"><div class="session-tool-timeline-icon ' + status + '">' + (status === 'done' ? '\u2713' : '\u25CF') + '</div><div class="session-tool-timeline-label">' + name + '</div><div class="session-tool-timeline-duration">' + duration + '</div></div>';
  }
  timeline += '</div></div>';
  return timeline;
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
    if (model.isReadOnly === true) return null;
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
      projections: sessionProjections([cockpit, summaryRecord, structured]),
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

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusLabel(status) {
    var labels = {
      running: 'Running',
      waiting_approval: 'Waiting for approval',
      failed: 'Failed',
      completed: 'Completed',
      cancelled: 'Cancelled',
      interrupted: 'Interrupted',
      unknown: 'Status unknown',
    };
    return labels[normalizeStatus(status)];
  }

  function pendingApprovalCount(session) {
    var approvals = Array.isArray(session.approvals) ? session.approvals : [];
    return approvals.filter(function (approval) {
      return (
        isRecord(approval) &&
        typeof approval.status === 'string' &&
        approval.status.trim().toLowerCase() === 'pending'
      );
    }).length;
  }

  function actionButton(action, session) {
    if (!action.visible) return '';
    return (
      '<button type="button" class="btn ' +
      (action.primary ? 'btn-primary' : 'btn-ghost') +
      '" data-work-session-action="' +
      esc(action.id) +
      '" data-session-id="' +
      esc(session.id) +
      '">' +
      esc(action.label) +
      '</button>'
    );
  }

  function sessionActions(session) {
    var status = normalizeStatus(session.status);
    var isWritable = session.isReadOnly !== true;
    var primaryAction = nextAction(session);
    return [
      {
        id: 'review_approvals',
        label: 'Review approvals',
        visible: isWritable && status === 'waiting_approval',
      },
      {
        id: 'resume',
        label: 'Resume',
        visible:
          isWritable &&
          session.canResume === true &&
          (status === 'running' || status === 'completed'),
      },
      {
        id: 'retry',
        label: 'Retry',
        visible:
          isWritable &&
          session.canRetry === true &&
          (status === 'failed' || status === 'cancelled'),
      },
      {
        id: 'cancel',
        label: 'Cancel',
        visible:
          isWritable &&
          session.canCancel === true &&
          (status === 'running' || status === 'waiting_approval'),
      },
    ].map(function (action) {
      action.primary = action.id === primaryAction;
      return action;
    });
  }

  function counter(label, value) {
    return (
      '<div class="work-session-counter"><span>' +
      esc(label) +
      '</span><strong>' +
      esc(value) +
      '</strong></div>'
    );
  }

  function renderRunStrip(session) {
    var model = asRecord(session);
    var progress =
      typeof model.progressPct === 'number' &&
      Number.isFinite(model.progressPct)
        ? Math.min(100, Math.max(0, model.progressPct))
        : null;
    var progressText = progress === null ? 'Not reported' : progress + '%';
    var progressElement =
      progress === null
        ? '<span class="work-session-progress-empty">Not reported</span>'
        : '<progress max="100" value="' +
          esc(progress) +
          '" aria-label="Session progress: ' +
          esc(progressText) +
          '"></progress>';
    var actions = sessionActions(model)
      .map(function (action) {
        return actionButton(action, model);
      })
      .join('');

    return (
      '<section class="work-session-run-strip" aria-live="polite" aria-atomic="true" data-session-status="' +
      esc(normalizeStatus(model.status)) +
      '">' +
      '<div class="work-session-run-status"><span>Status</span><strong>' +
      esc(statusLabel(model.status)) +
      '</strong><p>' +
      esc(model.currentStep || 'No current step reported') +
      '</p></div>' +
      '<div class="work-session-progress"><span>Progress</span><strong>' +
      esc(progressText) +
      '</strong>' +
      progressElement +
      '</div>' +
      '<div class="work-session-counters">' +
      counter(
        'Events',
        Array.isArray(model.timeline) ? model.timeline.length : 0,
      ) +
      counter(
        'Tool calls',
        Array.isArray(model.toolCalls) ? model.toolCalls.length : 0,
      ) +
      counter('Pending approvals', pendingApprovalCount(model)) +
      '</div>' +
      (actions
        ? '<div class="work-session-actions">' + actions + '</div>'
        : '') +
      '</section>'
    );
  }

  function eventLabel(event) {
    return stringValue(
      firstValue([event.title, event.name, event.label, event.type]),
    );
  }

  function eventDetail(event) {
    return stringValue(firstValue([event.detail, event.message, event.status]));
  }

  function renderTimeline(session) {
    var model = asRecord(session);
    var timeline = Array.isArray(model.timeline)
      ? model.timeline.filter(isRecord)
      : [];
    if (timeline.length === 0) {
      return '<ol class="work-session-timeline"><li class="work-session-empty">No timeline recorded</li></ol>';
    }
    return (
      '<ol class="work-session-timeline">' +
      timeline
        .map(function (event) {
          var detail = eventDetail(event);
          var timestamp = stringValue(event.timestamp);
          return (
            '<li class="work-session-timeline-event" data-event-type="' +
            esc(stringValue(event.type).toLowerCase()) +
            '"><div class="work-session-timeline-marker" aria-hidden="true"></div>' +
            '<div class="work-session-timeline-copy"><div class="work-session-timeline-head"><strong>' +
            esc(eventLabel(event) || 'Session event') +
            '</strong>' +
            (timestamp
              ? '<time datetime="' +
                esc(timestamp) +
                '">' +
                esc(timestamp) +
                '</time>'
              : '') +
            '</div>' +
            (detail ? '<p>' + esc(detail) + '</p>' : '') +
            '</div></li>'
          );
        })
        .join('') +
      '</ol>'
    );
  }

  function recordList(items, emptyMessage, className) {
    var records = Array.isArray(items) ? items.filter(isRecord) : [];
    if (records.length === 0) {
      return '<div class="work-session-empty">' + esc(emptyMessage) + '</div>';
    }
    return (
      '<ul class="work-session-records ' +
      esc(className) +
      '">' +
      records
        .map(function (record) {
          var label = stringValue(
            firstValue([
              record.title,
              record.name,
              record.label,
              record.path,
              record.id,
              record.type,
            ]),
          );
          var detail = eventDetail(record);
          return (
            '<li><strong>' +
            esc(label || 'Recorded item') +
            '</strong>' +
            (detail ? '<span>' + esc(detail) + '</span>' : '') +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function projectionPanel(projection, emptyMessage, className) {
    var model = asRecord(projection);
    var items = Array.isArray(model.items) ? model.items.filter(isRecord) : [];
    if (model.available !== true || items.length === 0) {
      var reason = stringValue(model.reason || 'not_recorded').replace(
        /_/g,
        ' ',
      );
      return (
        '<div class="work-session-projection work-session-projection-unavailable ' +
        esc(className) +
        '"><strong>Unavailable</strong><span>' +
        esc(emptyMessage) +
        '</span><small>Reason: ' +
        esc(reason) +
        '</small></div>'
      );
    }
    return (
      '<div class="work-session-projection ' +
      esc(className) +
      '"><ul class="work-session-records">' +
      items
        .map(function (item) {
          var title = stringValue(
            firstValue([item.title, item.role, item.type, item.id]),
          );
          var detail = stringValue(
            firstValue([item.content, item.summary, item.detail, item.status]),
          );
          var timestamp = stringValue(item.timestamp || item.createdAt);
          return (
            '<li><strong>' +
            esc(title || 'Recorded item') +
            '</strong>' +
            (detail ? '<span>' + esc(detail) + '</span>' : '') +
            (timestamp
              ? '<time datetime="' +
                esc(timestamp) +
                '">' +
                esc(timestamp) +
                '</time>'
              : '') +
            '</li>'
          );
        })
        .join('') +
      '</ul></div>'
    );
  }

  function fileList(files) {
    var entries = Array.isArray(files)
      ? files.filter(function (file) {
          return typeof file === 'string' && file.trim() !== '';
        })
      : [];
    if (entries.length === 0) {
      return '<div class="work-session-empty">No files recorded</div>';
    }
    return (
      '<ul class="work-session-records work-session-files">' +
      entries
        .map(function (file) {
          return '<li><code>' + esc(file) + '</code></li>';
        })
        .join('') +
      '</ul>'
    );
  }

  function truncateText(text, maxLen) {
    var str = stringValue(text);
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '\u2026';
  }

  function renderNarrative(session) {
    var model = asRecord(session);
    var projections = asRecord(model.projections);
    var sections = [];

    sections.push(
      '<div class="narrative-opening">' +
      '<div class="narrative-meta">' +
      '<span class="narrative-time">' + esc(model.startedAt || 'Unknown time') + '</span>' +
      '<span class="narrative-context">' + esc(model.group || 'Unknown group') + '</span>' +
      '<span class="narrative-mode">' + esc(model.mode || 'agent') + '</span>' +
      '</div>' +
      '<div class="narrative-status-line">' + esc(statusLabel(model.status)) +
      (model.currentStep ? ' \u2014 ' + esc(model.currentStep) : '') +
      '</div></div>'
    );

    var conversation = asRecord(projections.conversation);
    if (conversation.available === true && conversation.items.length > 0) {
      var reasoningHtml = '<section class="narrative-section"><h4>Reasoning chain</h4><div class="narrative-steps">';
      conversation.items.forEach(function (item, index) {
        var role = stringValue(item.role || item.type || 'step');
        var content = stringValue(item.content || item.summary || item.detail || '');
        reasoningHtml += '<div class="narrative-step">' +
          '<span class="narrative-step-index">' + (index + 1) + '</span>' +
          '<div class="narrative-step-body"><span class="narrative-role">' + esc(role) + '</span>' +
          '<p>' + esc(content) + '</p></div></div>';
      });
      reasoningHtml += '</div></section>';
      sections.push(reasoningHtml);
    }

    var plan = asRecord(projections.plan);
    if (plan.available === true && plan.items.length > 0) {
      var decisionsHtml = '<section class="narrative-section"><h4>Decision points</h4><div class="narrative-decisions">';
      plan.items.forEach(function (item) {
        var title = stringValue(item.title || item.name || 'Decision');
        var detail = stringValue(item.content || item.summary || item.detail || '');
        var itemStatus = stringValue(item.status || '');
        decisionsHtml += '<div class="narrative-decision">' +
          '<strong>' + esc(title) + '</strong>' +
          (itemStatus ? ' <span class="badge badge-muted">' + esc(itemStatus) + '</span>' : '') +
          (detail ? '<p>' + esc(detail) + '</p>' : '') +
          '</div>';
      });
      decisionsHtml += '</div></section>';
      sections.push(decisionsHtml);
    }

    var toolCalls = Array.isArray(model.toolCalls) ? model.toolCalls.filter(isRecord) : [];
    if (toolCalls.length > 0) {
      var actionsHtml = '<section class="narrative-section"><h4>Actions taken</h4><ol class="narrative-actions">';
      toolCalls.forEach(function (tc) {
        var name = stringValue(tc.name || 'tool');
        var output = stringValue(tc.output || tc.result || '');
        var duration = tc.duration ? ' (' + esc(String(tc.duration)) + 's)' : '';
        actionsHtml += '<li><code>' + esc(name) + '</code>' + duration +
          (output ? '<p class="narrative-tool-output">' + esc(truncateText(output, 300)) + '</p>' : '') +
          '</li>';
      });
      actionsHtml += '</ol></section>';
      sections.push(actionsHtml);
    }

    var files = Array.isArray(model.changedFiles) ? model.changedFiles : [];
    var artifacts = Array.isArray(model.artifacts) ? model.artifacts.filter(isRecord) : [];
    if (files.length > 0 || artifacts.length > 0) {
      var outcomeHtml = '<section class="narrative-section"><h4>Outcome</h4>';
      if (files.length > 0) {
        outcomeHtml += '<div class="narrative-outcome-group"><strong>Changed files</strong><ul class="narrative-files">' +
          files.map(function (f) { return '<li><code>' + esc(f) + '</code></li>'; }).join('') +
          '</ul></div>';
      }
      if (artifacts.length > 0) {
        outcomeHtml += '<div class="narrative-outcome-group"><strong>Artifacts</strong><ul class="narrative-artifacts">' +
          artifacts.map(function (a) {
            return '<li>' + esc(stringValue(a.title || a.name || a.path || a.id || 'artifact')) + '</li>';
          }).join('') +
          '</ul></div>';
      }
      outcomeHtml += '</section>';
      sections.push(outcomeHtml);
    }

    var journal = asRecord(projections.journalEvents);
    if (journal.available === true && journal.items.length > 0) {
      var journalHtml = '<section class="narrative-section"><h4>Journal</h4><div class="narrative-journal">';
      journal.items.forEach(function (item) {
        var title = stringValue(item.title || item.type || 'entry');
        var detail = stringValue(item.content || item.summary || item.detail || '');
        var timestamp = stringValue(item.timestamp || item.createdAt || '');
        journalHtml += '<div class="narrative-journal-entry">' +
          '<strong>' + esc(title) + '</strong>' +
          (timestamp ? ' <time>' + esc(timestamp) + '</time>' : '') +
          (detail ? '<p>' + esc(detail) + '</p>' : '') +
          '</div>';
      });
      journalHtml += '</div></section>';
      sections.push(journalHtml);
    }

    if (sections.length <= 1) {
      return '<div class="work-session-empty">No narrative data available for this session. The narrative view assembles reasoning, decisions, tool usage, and outcomes into a readable story.</div>';
    }

    return '<div class="session-narrative">' + sections.join('') + '</div>';
  }

  function renderSessionApprovals(session) {
    var approvals = Array.isArray(session.approvals) ? session.approvals.filter(isRecord) : [];
    if (approvals.length === 0) {
      return '<div class="work-session-empty">No approvals recorded</div>';
    }
    return '<ul class="work-session-records work-session-approvals">' +
      approvals.map(function (approval) {
        var title = stringValue(approval.title || approval.kind || approval.id || 'Approval');
        var detail = stringValue(approval.summary || approval.detail || '');
        var status = stringValue(approval.status || 'pending').toLowerCase();
        var id = stringValue(approval.id || '');
        var isPending = status === 'pending';
        var actions = '';
        if (isPending && id) {
          actions = '<div class="session-approval-actions">' +
            '<button type="button" class="btn btn-sm btn-primary" data-session-approval-action="approve" data-approval-id="' + esc(id) + '">Approve</button>' +
            '<button type="button" class="btn btn-sm btn-danger" data-session-approval-action="deny" data-approval-id="' + esc(id) + '">Deny</button>' +
            '</div>';
        }
        return '<li class="session-approval-item ' + (isPending ? 'is-pending' : 'is-resolved') + '">' +
          '<div class="session-approval-main"><strong>' + esc(title) + '</strong>' +
          ' <span class="badge ' + (isPending ? 'badge-warning' : 'badge-muted') + '">' + esc(status) + '</span>' +
          (detail ? '<p>' + esc(detail) + '</p>' : '') +
          '</div>' + actions + '</li>';
      }).join('') + '</ul>';
  }

  var inspectorTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'narrative', label: 'Narrative' },
    { id: 'conversation', label: 'Conversation' },
    { id: 'plan', label: 'Plan & tasks' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'tools', label: 'Tools' },
    { id: 'files', label: 'Files' },
    { id: 'proposals', label: 'Proposals' },
    { id: 'journal', label: 'Journal' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'artifacts', label: 'Artifacts' },
  ];

  function validInspectorTab(value) {
    if (typeof value !== 'string') return 'overview';
    var tab = value.trim().toLowerCase();
    return inspectorTabs.some(function (candidate) {
      return candidate.id === tab;
    })
      ? tab
      : 'overview';
  }

  function inspectorPanel(session, activeTab) {
    var projections = asRecord(session.projections);
    if (activeTab === 'narrative') return renderNarrative(session);
    if (activeTab === 'conversation') {
      return projectionPanel(
        projections.conversation,
        'No conversation transcript was recorded for this session.',
        'conversation',
      );
    }
    if (activeTab === 'plan') {
      return projectionPanel(
        projections.plan,
        'No plan or task projection is available for this session.',
        'plan',
      );
    }
    if (activeTab === 'timeline') return renderTimeline(session);
    if (activeTab === 'tools') {
      return renderToolCallTimeline(session.toolCalls);
    }
    if (activeTab === 'files') return fileList(session.changedFiles);
    if (activeTab === 'proposals') {
      var memory = projectionPanel(
        projections.memoryProposals,
        'No memory proposals were recorded for this session.',
        'memory-proposals',
      );
      var skills = projectionPanel(
        projections.skillProposals,
        'No skill proposals were recorded for this session.',
        'skill-proposals',
      );
      var legacy = recordList(
        session.proposals,
        'No proposals recorded',
        'work-session-proposals',
      );
      return (
        '<div class="work-session-projection-stack">' +
        memory +
        skills +
        legacy +
        '</div>'
      );
    }
    if (activeTab === 'journal') {
      return projectionPanel(
        projections.journalEvents,
        'No journal events were recorded for this session.',
        'journal-events',
      );
    }
    if (activeTab === 'approvals') {
      return (
        '<div class="work-session-panel-summary">' +
        counter('Pending approvals', pendingApprovalCount(session)) +
        '</div>' +
        renderSessionApprovals(session)
      );
    }
    if (activeTab === 'artifacts') {
      return recordList(
        session.artifacts,
        'No artifacts recorded',
        'work-session-artifacts',
      );
    }
    return (
      '<div class="work-session-overview"><h3>Session overview</h3>' +
      '<div class="work-session-overview-grid">' +
      counter('Status', statusLabel(session.status)) +
      counter('Pending approvals', pendingApprovalCount(session)) +
      counter(
        'Changed files',
        Array.isArray(session.changedFiles) ? session.changedFiles.length : 0,
      ) +
      counter(
        'Artifacts',
        Array.isArray(session.artifacts) ? session.artifacts.length : 0,
      ) +
      '</div>' +
      (session.currentStep
        ? '<p class="work-session-current-step">' +
          esc(session.currentStep) +
          '</p>'
        : '<div class="work-session-empty">No current step recorded</div>') +
      '</div>'
    );
  }

  function domIdToken(value) {
    var text = stringValue(value);
    if (!text) return 'u-empty';
    return (
      'u-' +
      Array.from(text)
        .map(function (character) {
          return character.codePointAt(0).toString(16);
        })
        .join('-')
    );
  }

  function renderInspector(session, activeTab) {
    var model = asRecord(session);
    var selectedTab = validInspectorTab(activeTab);
    var token = domIdToken(model.id);
    var titleId = 'work-session-' + token + '-title';
    var panelId = 'work-session-' + token + '-panel';
    var selectedTabId = 'work-session-' + token + '-' + selectedTab + '-tab';

    return (
      '<section class="work-session-inspector" role="region" aria-labelledby="' +
      esc(titleId) +
      '" tabindex="-1">' +
      '<header class="work-session-inspector-head"><div><span>Work session</span><h2 id="' +
      esc(titleId) +
      '">' +
      esc(model.group || model.id || 'Session details') +
      '</h2></div><strong class="work-session-status">' +
      esc(statusLabel(model.status)) +
      '</strong></header>' +
      '<div class="work-session-tabs" role="tablist" aria-label="Session details">' +
      inspectorTabs
        .map(function (tab) {
          var selected = tab.id === selectedTab;
          return (
            '<button type="button" id="work-session-' +
            esc(token) +
            '-' +
            tab.id +
            '-tab" role="tab" data-work-session-tab="' +
            tab.id +
            '" aria-selected="' +
            (selected ? 'true' : 'false') +
            '" aria-controls="' +
            esc(panelId) +
            '" tabindex="' +
            (selected ? '0' : '-1') +
            '">' +
            esc(tab.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<div id="' +
      esc(panelId) +
      '" class="work-session-panel" role="tabpanel" aria-labelledby="' +
      esc(selectedTabId) +
      '" tabindex="0">' +
      inspectorPanel(model, selectedTab) +
      '</div></section>'
    );
  }

  window.NanoWorkSession = {
    normalize: normalize,
    normalizeStatus: normalizeStatus,
    nextAction: nextAction,
    renderRunStrip: renderRunStrip,
    renderTimeline: renderTimeline,
    renderInspector: renderInspector,
  };
})();
