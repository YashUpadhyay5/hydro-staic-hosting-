const Geofence = require('../../../../shared/models/Geofence');
const Media = require('../../../../shared/models/Media');
const { getDistance } = require('../../../../core/utils/siteCache');

class GeofenceMediaSyncService {
  /**
   * Re-evaluates all geotagged photos against all active geofences in the database.
   * Updates siteId on each photo to the closest matching geofence (within radius + 30m buffer),
   * or sets siteId to null if outside all boundaries.
   */
  static async reclassifyAllMedia(io = null) {
    try {
      const [allMedia, allGeofences] = await Promise.all([
        Media.findAll(),
        Geofence.findAll()
      ]);

      let updatedCount = 0;

      for (const m of allMedia) {
        if (m.latitude == null || m.longitude == null) continue;
        const latNum = Number(m.latitude);
        const lonNum = Number(m.longitude);
        if (isNaN(latNum) || isNaN(lonNum)) continue;

        let closestGf = null;
        let minDist = Infinity;

        for (const gf of allGeofences) {
          const gLat = Number(gf.latitude);
          const gLng = Number(gf.longitude);
          const radius = Number(gf.radius) || 300;
          const dist = getDistance(latNum, lonNum, gLat, gLng);
          const maxAllowed = radius + 30; // 30m GPS drift buffer

          if (dist <= maxAllowed && dist < minDist) {
            minDist = dist;
            closestGf = gf;
          }
        }

        const newSiteId = closestGf ? closestGf.id : null;
        if (m.siteId !== newSiteId) {
          m.siteId = newSiteId;
          await m.save();
          updatedCount++;
        }
      }

      console.log(`[GeofenceSync] reclassifyAllMedia completed. Updated ${updatedCount} media records.`);

      if (io) {
        io.emit('media:clusters_updated', { updatedCount, timestamp: Date.now() });
      }

      return { success: true, updatedCount };
    } catch (err) {
      console.error('[GeofenceSync Error] reclassifyAllMedia failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Called when a new geofence is created or an existing geofence boundary is modified.
   * Checks unassigned photos across history or photos currently linked to this geofence.
   */
  static async onGeofenceAddedOrUpdated(geofence, io = null) {
    if (!geofence || !geofence.id) return;

    try {
      const gLat = Number(geofence.latitude);
      const gLng = Number(geofence.longitude);
      const radius = Number(geofence.radius) || 300;
      const maxAllowed = radius + 30;

      // Scan all media that have coordinates
      const allMedia = await Media.findAll();
      let updatedCount = 0;

      for (const m of allMedia) {
        if (m.latitude == null || m.longitude == null) continue;
        const latNum = Number(m.latitude);
        const lonNum = Number(m.longitude);
        if (isNaN(latNum) || isNaN(lonNum)) continue;

        const dist = getDistance(latNum, lonNum, gLat, gLng);

        if (dist <= maxAllowed) {
          // Photo is inside this geofence boundary
          if (m.siteId !== geofence.id) {
            m.siteId = geofence.id;
            await m.save();
            updatedCount++;
          }
        } else if (m.siteId === geofence.id) {
          // Photo was previously linked to this geofence, but boundary shrank and it is now outside
          // Attempt to find any other covering geofence or set to null
          const allGeofences = await Geofence.findAll();
          let alternativeGf = null;
          let altMinDist = Infinity;

          for (const otherGf of allGeofences) {
            if (otherGf.id === geofence.id) continue;
            const otherDist = getDistance(latNum, lonNum, Number(otherGf.latitude), Number(otherGf.longitude));
            const otherAllowed = (Number(otherGf.radius) || 300) + 30;
            if (otherDist <= otherAllowed && otherDist < altMinDist) {
              altMinDist = otherDist;
              alternativeGf = otherGf;
            }
          }

          m.siteId = alternativeGf ? alternativeGf.id : null;
          await m.save();
          updatedCount++;
        }
      }

      console.log(`[GeofenceSync] onGeofenceAddedOrUpdated for "${geofence.name}" (ID: ${geofence.id}): updated ${updatedCount} media records.`);

      if (io && updatedCount > 0) {
        io.emit('media:clusters_updated', { geofenceId: geofence.id, updatedCount, timestamp: Date.now() });
      }

      return { success: true, updatedCount };
    } catch (err) {
      console.error(`[GeofenceSync Error] onGeofenceAddedOrUpdated failed for geofence ${geofence.id}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Called when a geofence is deleted.
   * Finds all historical photos that were linked to this geofence, and re-evaluates them.
   * If another active geofence covers them, links to that; otherwise sets siteId = null.
   */
  static async onGeofenceDeleted(deletedGeofenceId, io = null) {
    if (!deletedGeofenceId) return;

    try {
      const affectedMedia = await Media.findAll({
        where: { siteId: deletedGeofenceId }
      });

      if (affectedMedia.length === 0) return { success: true, updatedCount: 0 };

      const activeGeofences = await Geofence.findAll();
      let reassignedCount = 0;
      let unassignedCount = 0;

      for (const m of affectedMedia) {
        let replacementGf = null;
        let minDist = Infinity;

        if (m.latitude != null && m.longitude != null) {
          const latNum = Number(m.latitude);
          const lonNum = Number(m.longitude);

          for (const gf of activeGeofences) {
            const dist = getDistance(latNum, lonNum, Number(gf.latitude), Number(gf.longitude));
            const maxAllowed = (Number(gf.radius) || 300) + 30;
            if (dist <= maxAllowed && dist < minDist) {
              minDist = dist;
              replacementGf = gf;
            }
          }
        }

        m.siteId = replacementGf ? replacementGf.id : null;
        await m.save();

        if (replacementGf) {
          reassignedCount++;
        } else {
          unassignedCount++;
        }
      }

      console.log(`[GeofenceSync] onGeofenceDeleted for ID ${deletedGeofenceId}: ${reassignedCount} reassigned, ${unassignedCount} marked unassigned.`);

      if (io) {
        io.emit('media:clusters_updated', { deletedGeofenceId, updatedCount: affectedMedia.length, timestamp: Date.now() });
      }

      return { success: true, updatedCount: affectedMedia.length, reassignedCount, unassignedCount };
    } catch (err) {
      console.error(`[GeofenceSync Error] onGeofenceDeleted failed for ID ${deletedGeofenceId}:`, err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = GeofenceMediaSyncService;
