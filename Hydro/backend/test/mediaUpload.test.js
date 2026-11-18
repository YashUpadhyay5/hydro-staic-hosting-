// A geotagged photo is kept even when grouping it into a location cluster fails
// (e.g. the clusters table rejecting a new row). Run with: npm test. Uses a throwaway SQLite database.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'media-upload-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
require(path.join(src, 'shared/models'));
const Media = require(path.join(src, 'shared/models/Media'));
const Cluster = require(path.join(src, 'shared/models/Cluster'));
require(path.join(src, 'shared/models/ClusterSetting'));

// a 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('geotagged media upload', async (t) => {
  await sequelize.sync({ force: true });
  const app = express();
  app.use(express.json());
  app.use('/api/media', require(path.join(src, 'modules/hrms/attendance/routes/media')));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/media`;
  t.after(async () => { server.close(); await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

  const upload = (extra = {}) => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'photo.png');
    const fields = { userId: 'HMPL067', userName: 'Field Test', latitude: '31.8209708', longitude: '74.9993488', address: 'Budha Theh, Punjab', mediaType: 'image', ...extra };
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    return fetch(url, { method: 'POST', body: form });
  };

  await t.test('a photo at a new place creates a cluster and is saved', async () => {
    const res = await upload();
    assert.equal(res.status, 201);
    const media = await res.json();
    assert.ok(media.clusterId, 'put into a new cluster');
    assert.equal(await Cluster.count(), 1);
  });

  await t.test('when the cluster cannot be created the photo is still saved, without a cluster', async () => {
    const create = Cluster.create;
    Cluster.create = async () => { throw new Error('null value in column "id" of relation "clusters" violates not-null constraint'); };
    const before = await Media.count();
    try {
      const res = await upload({ latitude: '13.0827', longitude: '80.2707', address: 'Chennai' });
      assert.equal(res.status, 201, 'the upload is not rejected');
      const media = await res.json();
      assert.equal(media.clusterId, null);
      assert.equal(await Media.count(), before + 1);
      const file = path.join(TMP, media.filePath);
      assert.ok(fs.existsSync(file), 'the file is kept on disk');
    } finally {
      Cluster.create = create;
    }
  });
});
