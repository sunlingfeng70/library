import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum ReaderType {
  Student = 'student',
  Teacher = 'teacher',
  Adult = 'adult',
  Child = 'child',
}

@Entity('reader')
@Unique(['cardNumber'])
@Unique(['openid'])
export class Reader {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'card_number' })
  cardNumber!: string;

  @Column()
  name!: string;

  @Column({ name: 'reader_type', type: 'enum', enum: ReaderType })
  readerType!: ReaderType;

  @Column({ type: 'varchar', nullable: true })
  openid!: string | null;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}