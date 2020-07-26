import express from 'express';
import bodyParser from 'body-parser';
import { MongoClient } from 'mongodb';
import path from 'path';

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '/build')));
const codeHash = 'abcdefghijklmnopqrstuvwxyz1234567890';

const withDB = async (operations, res) => {
	try {
		const client = await MongoClient.connect('mongodb://localhost:27017', {
			useNewUrlParser: true,
			useUnifiedTopology: true,
		});
		const db = client.db('grocer');

		await operations(db);
		client.close();
	} catch (error) {
		res.status(500).json({ message: 'Error connecting to db', error });
	}
};

app.post('/api/sign-up/', (req, res) => {
	const enteredUser = req.body.username;
	if (enteredUser === 'listKey') res.send('This name is not allowed.');
	const enteredEmail = req.body.email;
	const enteredPass = req.body.password;

	const crypto = require('crypto');
	const algorithm = 'aes-256-cbc'; // or any other algorithm supported by OpenSSL
	let key = "crypto.createHash(algorithm).update(enteredPass).digest('base64')".substr(0, 32);
	const iv = Buffer.alloc(16, 0);

	withDB(async (db) => {
		const query = await db.collection('person').findOne({ username: enteredUser });
		const queryEmail = await db.collection('person').findOne({ email: enteredEmail });

		if (query === null && queryEmail === null) {
			let cipher = crypto.createCipheriv(algorithm, key, iv);
			const encrypted = cipher.update(enteredPass, 'utf8', 'hex') + cipher.final('hex');
			const ans = await db
				.collection('person')
				.insertOne({ username: enteredUser, email: enteredEmail, password: encrypted, lists: [] });

			const newPerson = await db.collection('person').findOne({ username: enteredUser });
			res.status(200).json(newPerson);
		} else {
			const newEmail = queryEmail === null ? true : false;
			const newUser = query === null ? true : false;

			res.send({ newUser: newUser, newEmail: newEmail });
		}
	}, res);
});

app.post('/api/login/', (req, res) => {
	withDB(async (db) => {
		const enteredUser = req.body.username;
		const enteredPass = req.body.password;

		const crypto = require('crypto');
		const algorithm = 'aes-256-cbc'; // or any other algorithm supported by OpenSSL
		let key = "crypto.createHash(algorithm).update(enteredPass).digest('base64')".substr(0, 32);
		const iv = Buffer.alloc(16, 0);

		const query = await db.collection('person').findOne({ username: enteredUser });

		if (query === null) res.send('Account Does Not Exist.');
		else {
			let decipher = crypto.createDecipheriv(algorithm, key, iv);
			let decrypted = decipher.update(query.password, 'hex', 'utf8') + decipher.final('utf8');
			if (decrypted === enteredPass) res.send(true);
			else res.send('Incorrect Password.');
		}
	}, res);
});

app.post('/api/create-list', (req, res) => {
	withDB(async (db) => {
		const listname = req.body.listname;
		const username = req.body.username;
		const col = await db.listCollections().toArray();
		col.forEach(function (item) {
			if (item.name === listname) res.send('List already exists.');
		});

		const query = await db.collection('person').findOne({ lists: listname });
		if (query !== null) res.send('You already have this list.');
		else {
			await db.collection('person').findOneAndUpdate({ username: username }, { $push: { lists: listname } });
			await db.createCollection(listname, {});
			await db.collection(listname).insertOne({ listKey: generateKey(6) });
			res.send('true');
		}
	}, res);
});

app.post('/api/add-member', (req, res) => {
	withDB(async (db) => {
		const username = req.body.username;
		const listname = req.body.tempname;
		const listCode = req.body.enteredCode;

		const alreadyHave = await db.collection('person').findOne({ username: username });
		alreadyHave.lists.forEach(function (item) {
			if (item === listname) {
				res.send('You already have this list.');
				alreadyHave = null;
			}
		});

		if (alreadyHave !== null) {
			const query = await db.collection(listname).findOne({ listKey: listCode });
			if (query !== null) {
				await db.collection('person').findOneAndUpdate({ username: username }, { $push: { lists: listname } });
				res.send(true);
			} else res.send('Failed to add you to list.');
		}
	}, res);
});

app.post('/api/add-item', (req, res) => {
	withDB(async (db) => {
		const username = req.body.username;
		const listname = req.body.currentList;
		const item = req.body.item;
		const price = req.body.price;

		const query = await db.collection(listname).findOne({ username: username });
		if (query !== null) {
			await db
				.collection(listname)
				.findOneAndUpdate({ username: username }, { $push: { items: { item, price, completed: '' } } });
			res.send('true');
		} else {
			db.collection(listname).insertOne({ username: username, items: [{ item, price, completed: ''  }] });
			res.send('true');
		}
	}, res);
});

app.post('/api/delete-item', (req, res) => {
	withDB(async (db) => {
		const username = req.body.username;
		const listname = req.body.currentList;
		const item = req.body.item;
		const price = req.body.price;

		await db.collection(listname).findOneAndUpdate(
			{ username: username },
			{
				$pull: {
					items: {
						item: item,
						price: price,
					},
				},
			},
			{ multi: false }
		);

		res.send('true');
	}, res);
});

app.post('/api/complete-item', (req, res) => {
	withDB(async (db) => {
		const listname = req.body.currentList;
		const item = req.body.item;
		const price = req.body.price;

		const query = await db.collection(listname).findOneAndUpdate(
			{items: {$elemMatch: {item: item, price: price}}},
			{
				$set:{ "items.$.completed" : true } 
			},
			{ multi: false }
		);

		res.send(true);
	}, res);
});

function generateKey(length) {
	var str = '';
	for (let i = 0; i < length; i++) {
		str += codeHash.charAt(Math.floor(Math.random() * codeHash.length));
	}
	return str;
}

app.get('/api/list-code/:listname', async (req, res) => {
	withDB(async (db) => {
		const listname = req.params.listname;
		const result = await db.collection(listname).find({}).toArray();
		if (result != null) res.send(result[0].listKey);
		else res.send(null);
	}, res);
});

app.get('/api/lists-per-person/:username', async (req, res) => {
	withDB(async (db) => {
		const username = req.params.username;
		const result = await db.collection('person').findOne({ username: username });
		res.send(result.lists);
	}, res);
});

app.get('/api/items-per-list/:currentList/', async (req, res) => {
	withDB(async (db) => {
		const listname = req.params.currentList;
		const result = await db.collection(listname).find({}).toArray();
		if (result != null) res.send(result.slice(1));
		else res.send(null);
	}, res);
});

app.get('/api/test', (req, res) => res.send('works!'));
app.post('/api/test', (req, res) => res.send('post works!'));

app.get('*', (req, res) => {
	res.sendFile(path.join(__dirname + '/build/index.html'));
})

app.listen(8000, () => console.log('Listening on port 8000'));
